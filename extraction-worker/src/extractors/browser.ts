/**
 * Generic browser-based content extraction via Playwright.
 *
 * Manages a shared Chromium instance (lazy-created, idle-timeout) and exposes
 * an `extractWithBrowser(url, options)` function that renders a page and
 * extracts title, text, HTML, images, author, and publication date.
 *
 * Used by the HTTP server (`server.ts`) to provide a browser extraction
 * service for Vercel-side callers (pre-crawl, extract-url API).
 */
import { chromium, type Browser, type Page } from "playwright";
import { createHash } from "node:crypto";
import { uploadBufferToBlob } from "../upload.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface BrowserExtractOptions {
  timeoutMs?: number;
  maxTextChars?: number;
  maxImages?: number;
}

export interface BrowserExtractResult {
  source_url: string;
  resolved_url: string;
  title: string;
  text: string;
  html: string;
  images: Array<{ url: string; alt: string }>;
  author: string;
  published_at: string;
}

// ---------------------------------------------------------------------------
// Browser pool — lazy singleton with idle timeout
// ---------------------------------------------------------------------------

const MAX_CONCURRENT_PAGES = 3;
const IDLE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

let browserInstance: Browser | null = null;
let activePages = 0;
let idleTimer: ReturnType<typeof setTimeout> | null = null;

async function acquireBrowser(): Promise<Browser> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }

  if (browserInstance && browserInstance.isConnected()) {
    activePages++;
    return browserInstance;
  }

  const proxyUrl =
    process.env.https_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy ||
    "";

  const launchOptions: Record<string, unknown> = {
    headless: true,
    channel: "chrome",
    args: ["--disable-blink-features=AutomationControlled"],
  };
  if (proxyUrl) {
    launchOptions.proxy = { server: proxyUrl };
  }

  browserInstance = await chromium.launch(launchOptions);
  activePages++;
  console.log("[browser] Chromium instance launched");
  return browserInstance;
}

function releasePage(): void {
  activePages = Math.max(0, activePages - 1);
  if (activePages === 0) {
    idleTimer = setTimeout(async () => {
      if (browserInstance && activePages === 0) {
        await browserInstance.close().catch(() => {});
        browserInstance = null;
        console.log("[browser] Chromium instance closed (idle timeout)");
      }
    }, IDLE_TIMEOUT_MS);
  }
}

/** Gracefully shut down the browser pool. */
export async function closeBrowserPool(): Promise<void> {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (browserInstance) {
    await browserInstance.close().catch(() => {});
    browserInstance = null;
  }
}

// ---------------------------------------------------------------------------
// Concurrency semaphore
// ---------------------------------------------------------------------------

let waiting: Array<() => void> = [];

async function acquireSlot(): Promise<void> {
  if (activePages < MAX_CONCURRENT_PAGES) return;
  await new Promise<void>((resolve) => {
    waiting.push(resolve);
  });
}

function releaseSlot(): void {
  const next = waiting.shift();
  if (next) next();
}

// ---------------------------------------------------------------------------
// HTML helpers (inline, no external deps)
// ---------------------------------------------------------------------------

function removeNoiseTags(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, " ")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, " ");
}

function htmlToText(html: string, maxChars: number): string {
  const withBreaks = html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(
      /<\/\s*(p|div|article|section|li|h[1-6]|blockquote|pre|tr|td)\s*>/gi,
      "\n",
    );
  const stripped = withBreaks.replace(/<[^>]+>/g, " ");
  const decoded = stripped
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
  const normalized = decoded
    .replace(/\u00a0/g, " ")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
  return normalized.length <= maxChars
    ? normalized
    : `${normalized.slice(0, maxChars - 1).trimEnd()}…`;
}

// ---------------------------------------------------------------------------
// WeChat image download & Blob upload
// ---------------------------------------------------------------------------

const WECHAT_IMG_CONCURRENCY = 5;
const WECHAT_IMG_TIMEOUT_MS = 15_000;

function isWechatUrl(url: string): boolean {
  return url.includes("mp.weixin.qq.com");
}

function isWechatImageUrl(url: string): boolean {
  return url.includes("mmbiz.qpic.cn") || url.includes("mmbiz.qlogo.cn");
}

function guessWechatImageExt(url: string, contentType?: string): string {
  if (contentType?.includes("png")) return ".png";
  if (contentType?.includes("gif")) return ".gif";
  if (contentType?.includes("webp")) return ".webp";
  if (url.includes("wx_fmt=png")) return ".png";
  if (url.includes("wx_fmt=gif")) return ".gif";
  if (url.includes("wx_fmt=webp")) return ".webp";
  return ".jpg";
}

async function downloadWechatImage(imageUrl: string): Promise<{ buffer: Buffer; contentType: string } | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), WECHAT_IMG_TIMEOUT_MS);
    const response = await fetch(imageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Referer: "https://mp.weixin.qq.com/",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    const contentType = response.headers.get("content-type") || "image/jpeg";
    return { buffer: Buffer.from(await response.arrayBuffer()), contentType };
  } catch {
    return null;
  }
}

/**
 * Download WeChat images and upload to Vercel Blob, then replace URLs in HTML and images list.
 */
async function replaceWechatImages(
  html: string,
  images: Array<{ url: string; alt: string }>,
  sourceUrl: string,
): Promise<{ html: string; images: Array<{ url: string; alt: string }> }> {
  // Collect all unique mmbiz URLs from both HTML and images list
  const urlSet = new Set<string>();
  const imgSrcRe = /(?:src|data-src|data-original)\s*=\s*["']([^"']*mmbiz\.qpic\.cn[^"']*)["']/gi;
  let match: RegExpExecArray | null = null;
  while ((match = imgSrcRe.exec(html)) !== null) {
    urlSet.add(match[1]);
  }
  for (const img of images) {
    if (isWechatImageUrl(img.url)) urlSet.add(img.url);
  }

  if (urlSet.size === 0) return { html, images };

  const allUrls = Array.from(urlSet);
  const urlHash = createHash("md5").update(sourceUrl).digest("hex").slice(0, 12);
  const urlMap = new Map<string, string>(); // original -> blob URL

  // Download & upload in batches
  for (let i = 0; i < allUrls.length; i += WECHAT_IMG_CONCURRENCY) {
    const batch = allUrls.slice(i, i + WECHAT_IMG_CONCURRENCY);
    const results = await Promise.all(
      batch.map(async (originalUrl, batchIdx) => {
        const idx = i + batchIdx;
        const result = await downloadWechatImage(originalUrl);
        if (!result || result.buffer.length < 100) return null;
        const ext = guessWechatImageExt(originalUrl, result.contentType);
        try {
          const uploaded = await uploadBufferToBlob(
            `wechat-${urlHash}`,
            result.buffer,
            `img-${idx}${ext}`,
            "images",
          );
          return { originalUrl, blobUrl: uploaded.url };
        } catch (err) {
          console.warn(`[browser] Failed to upload wechat image ${idx}: ${err instanceof Error ? err.message : err}`);
          return null;
        }
      }),
    );
    for (const r of results) {
      if (r) urlMap.set(r.originalUrl, r.blobUrl);
    }
  }

  if (urlMap.size === 0) return { html, images };

  console.log(`[browser] Replaced ${urlMap.size}/${allUrls.length} wechat images with Blob URLs`);

  // Replace URLs in HTML (handle both raw and HTML-entity-encoded URLs)
  let newHtml = html;
  for (const [original, blob] of urlMap) {
    newHtml = newHtml.split(original).join(blob);
    // Also replace HTML-entity-encoded version (& → &amp;)
    const encoded = original.replace(/&/g, "&amp;");
    if (encoded !== original) {
      newHtml = newHtml.split(encoded).join(blob);
    }
  }

  // Replace URLs in images list
  const newImages = images.map((img) => {
    const blobUrl = urlMap.get(img.url);
    return blobUrl ? { ...img, url: blobUrl } : img;
  });

  return { html: newHtml, images: newImages };
}

// ---------------------------------------------------------------------------
// Core extraction
// ---------------------------------------------------------------------------

export async function extractWithBrowser(
  url: string,
  options: BrowserExtractOptions = {},
): Promise<BrowserExtractResult> {
  const timeoutMs = options.timeoutMs ?? 30_000;
  const maxTextChars = options.maxTextChars ?? 120_000;
  const maxImages = options.maxImages ?? 24;

  await acquireSlot();
  const browser = await acquireBrowser();

  let page: Page | null = null;
  try {
    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "zh-CN",
      viewport: { width: 1440, height: 900 },
    });

    page = await context.newPage();

    // Anti-detection
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });

    // Navigate
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });

    // Wait for content to stabilise
    await page
      .waitForLoadState("networkidle", { timeout: Math.min(timeoutMs, 15_000) })
      .catch(() => {});

    // Extract data in page context
    const data = await page.evaluate(
      ({ maxImgs }) => {
        // Title
        const ogTitle =
          document
            .querySelector('meta[property="og:title"]')
            ?.getAttribute("content") || "";
        const titleEl = document.querySelector("title");
        const title = ogTitle || titleEl?.textContent?.trim() || "";

        // Author
        const authorMeta =
          document
            .querySelector(
              'meta[name="author"], meta[property="og:site_name"], meta[property="article:author"]',
            )
            ?.getAttribute("content") || "";

        // Published date
        const publishedMeta =
          document
            .querySelector(
              'meta[property="article:published_time"], meta[name="publish_time"], meta[name="pubdate"]',
            )
            ?.getAttribute("content") || "";

        // Content HTML — prefer <article>, then <main>, then <body>
        const articleEl = document.querySelector("article");
        const mainEl = document.querySelector("main");
        const contentHtml = articleEl
          ? articleEl.innerHTML
          : mainEl
            ? mainEl.innerHTML
            : document.body?.innerHTML || "";

        // Images
        const images: Array<{ url: string; alt: string }> = [];
        const seen = new Set<string>();

        // og:image first
        const ogImage =
          document
            .querySelector('meta[property="og:image"]')
            ?.getAttribute("content") || "";
        if (ogImage) {
          try {
            const resolved = new URL(ogImage, location.href).toString();
            if (!seen.has(resolved)) {
              seen.add(resolved);
              images.push({ url: resolved, alt: "" });
            }
          } catch {}
        }

        // img tags from content area
        const container =
          document.querySelector("article") ||
          document.querySelector("main") ||
          document.body;
        if (container) {
          const imgEls = container.querySelectorAll("img");
          for (const img of imgEls) {
            if (images.length >= maxImgs) break;
            const src =
              img.src ||
              img.getAttribute("data-src") ||
              img.getAttribute("data-original") ||
              "";
            if (!src || src.startsWith("data:")) continue;
            try {
              const resolved = new URL(src, location.href).toString();
              if (!seen.has(resolved)) {
                seen.add(resolved);
                images.push({ url: resolved, alt: img.alt || "" });
              }
            } catch {}
          }
        }

        return {
          title,
          author: authorMeta,
          published_at: publishedMeta,
          contentHtml,
          images,
          resolvedUrl: location.href,
        };
      },
      { maxImgs: maxImages },
    );

    // Get full page HTML for fallback text extraction
    const fullHtml = data.contentHtml || "";
    const cleanHtml = removeNoiseTags(fullHtml);
    const text = htmlToText(cleanHtml, maxTextChars);

    await context.close();

    // For WeChat articles, download images to Vercel Blob to bypass hotlink protection
    let finalHtml = cleanHtml;
    let finalImages = data.images || [];
    if (isWechatUrl(url)) {
      try {
        const replaced = await replaceWechatImages(cleanHtml, data.images || [], url);
        finalHtml = replaced.html;
        finalImages = replaced.images;
      } catch (err) {
        console.warn(`[browser] WeChat image replacement failed, using originals: ${err instanceof Error ? err.message : err}`);
      }
    }

    return {
      source_url: url,
      resolved_url: data.resolvedUrl || url,
      title: data.title || "",
      text,
      html: finalHtml,
      images: finalImages,
      author: data.author || "",
      published_at: data.published_at || "",
    };
  } finally {
    releasePage();
    releaseSlot();
  }
}
