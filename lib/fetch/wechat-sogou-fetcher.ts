import crypto from "node:crypto";
import { Article, SourceConfig } from "@/lib/domain/models";
import { currentDateInTimezone, getWechatFreshnessMaxAgeDays, isPublishedWithinReportWindow } from "@/lib/domain/article-identity";
import { retryWithBackoff } from "./retry";

const TAG_RE = /<[^>]+>/g;
const MULTISPACE_RE = /\s+/g;
const SOGOU_WECHAT_HOST = "weixin.sogou.com";

function cleanHtmlText(value: string): string {
  return String(value || "")
    .replace(TAG_RE, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(MULTISPACE_RE, " ")
    .trim();
}

function makeArticleId(sourceId: string, url: string, title: string): string {
  const digest = crypto.createHash("sha256").update(`${sourceId}|${url}|${title}`).digest("hex").slice(0, 12);
  return `${sourceId}-${digest}`;
}

function cookieName(pair: string): string {
  return pair.split("=", 1)[0]?.trim() || "";
}

function mergeCookieHeader(existing: string, setCookieHeaders: string[]): string {
  const jar = new Map<string, string>();

  for (const pair of existing.split(/;\s*/).map((value) => value.trim()).filter(Boolean)) {
    const name = cookieName(pair);
    if (name) jar.set(name, pair);
  }

  for (const raw of setCookieHeaders) {
    const pair = String(raw || "").split(";", 1)[0]?.trim() || "";
    const name = cookieName(pair);
    if (name && pair) {
      jar.set(name, pair);
    }
  }

  return Array.from(jar.values()).join("; ");
}

function getSetCookieHeaders(response: Response): string[] {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  if (typeof headers.getSetCookie === "function") {
    return headers.getSetCookie().filter(Boolean);
  }
  const single = response.headers.get("set-cookie");
  return single ? [single] : [];
}

function buildHtmlHeaders(cookieHeader: string, referer?: string): Record<string, string> {
  return {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
    "Cache-Control": "no-cache",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    ...(referer ? { Referer: referer } : {}),
    ...(cookieHeader ? { Cookie: cookieHeader } : {}),
  };
}

async function fetchTextWithTimeout(
  url: string,
  timeoutMs: number,
  cookieHeader = "",
  referer = "",
): Promise<{ text: string; cookieHeader: string }> {
  return retryWithBackoff(
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      try {
        const response = await fetch(url, {
          method: "GET",
          redirect: "follow",
          headers: buildHtmlHeaders(cookieHeader, referer),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Sogou fetch failed: ${response.status}`);
        }

        return {
          text: await response.text(),
          cookieHeader: mergeCookieHeader(cookieHeader, getSetCookieHeaders(response)),
        };
      } finally {
        clearTimeout(timer);
      }
    },
    { maxRetries: 1, baseDelayMs: 1000 },
  );
}

function normalizeWechatSourceName(value: string): string {
  return String(value || "")
    .replace(/[（(]\s*微信\s*[)）]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function buildSearchUrl(source: SourceConfig): string {
  const query = String(source.wechatSogouQuery || "").trim() || normalizeWechatSourceName(source.name);
  if (!query) {
    throw new Error(`Missing wechat_sogou_query for source ${source.id}`);
  }
  return `https://${SOGOU_WECHAT_HOST}/weixin?type=2&query=${encodeURIComponent(query)}`;
}

function expectedAuthor(source: SourceConfig): string {
  return String(source.wechatSogouAuthor || "").trim() || normalizeWechatSourceName(source.name);
}

function comparePublishedAtDesc(
  left: { publishedAt: Date | null },
  right: { publishedAt: Date | null },
): number {
  const leftTs = left.publishedAt?.getTime() || 0;
  const rightTs = right.publishedAt?.getTime() || 0;
  return rightTs - leftTs;
}

function extractEntries(
  html: string,
  targetAuthor: string,
): Array<{
  title: string;
  summary: string;
  href: string;
  publishedAt: Date | null;
}> {
  const blocks = html.match(/<li id="sogou_vr_11002601_box_\d+"[\s\S]*?<\/li>/g) || [];
  const normalizedTarget = normalizeWechatSourceName(targetAuthor);
  const entries: Array<{
    title: string;
    summary: string;
    href: string;
    publishedAt: Date | null;
  }> = [];

  for (const block of blocks) {
    const author = cleanHtmlText(block.match(/<span class="all-time-y2">([\s\S]*?)<\/span>/)?.[1] || "");
    if (!author || normalizeWechatSourceName(author) !== normalizedTarget) {
      continue;
    }

    const hrefMatch = block.match(/<a[^>]+href="([^"]+)"[^>]+id="sogou_vr_11002601_title_\d+"/)
      || block.match(/<a[^>]+id="sogou_vr_11002601_title_\d+"[^>]+href="([^"]+)"/);
    const titleMatch = block.match(/id="sogou_vr_11002601_title_\d+"[^>]*>([\s\S]*?)<\/a>/);
    const title = cleanHtmlText(titleMatch?.[1] || "");
    const href = String(hrefMatch?.[1] || "").replace(/&amp;/g, "&").trim();
    const summary = cleanHtmlText(block.match(/<p class="txt-info"[^>]*>([\s\S]*?)<\/p>/)?.[1] || "");
    const timestamp = Number.parseInt(block.match(/timeConvert\('(\d+)'\)/)?.[1] || "", 10);

    if (!title || !href) {
      continue;
    }

    entries.push({
      title,
      summary,
      href,
      publishedAt: Number.isFinite(timestamp) ? new Date(timestamp * 1000) : null,
    });
  }

  return entries.sort(comparePublishedAtDesc);
}

function extractMpUrlFromSogouRedirectHtml(html: string): string {
  const start = html.search(/var url = ['"]/);
  const target = start >= 0 ? html.slice(start) : html;
  const parts = Array.from(target.matchAll(/url \+= (['"])(.*?)\1;/g)).map((match) => match[2] || "");
  const resolved = parts.join("").replace(/@/g, "").trim();
  return resolved.startsWith("https://mp.weixin.qq.com/") ? resolved : "";
}

export function shouldUseWechatSogou(source: SourceConfig): boolean {
  return source.fetchMethod === "wechat_sogou";
}

export async function fetchWechatSogouArticles(
  source: SourceConfig,
  options: { timeoutMs: number; maxItems: number; referenceDate?: string; timezoneName?: string },
): Promise<Article[]> {
  let cookieHeader = "";
  const searchUrl = buildSearchUrl(source);
  const searchPage = await fetchTextWithTimeout(searchUrl, options.timeoutMs, cookieHeader);
  cookieHeader = searchPage.cookieHeader;

  const timezoneName = String(options.timezoneName || process.env.DIGEST_TIMEZONE || "Asia/Shanghai").trim() || "Asia/Shanghai";
  const referenceDate = String(options.referenceDate || "").trim() || currentDateInTimezone(timezoneName);
  const maxAgeDays = getWechatFreshnessMaxAgeDays(String(process.env.WECHAT_SOGOU_MAX_AGE_DAYS || ""));
  const items = extractEntries(searchPage.text, expectedAuthor(source))
    .filter((item) => isPublishedWithinReportWindow(item.publishedAt, referenceDate, maxAgeDays, timezoneName))
    .slice(0, Math.max(0, options.maxItems));
  const articles: Article[] = [];
  const seenUrls = new Set<string>();

  for (const item of items) {
    const redirectUrl = item.href.startsWith("http") ? item.href : `https://${SOGOU_WECHAT_HOST}${item.href}`;
    let resolvedUrl = "";

    try {
      const redirectPage = await fetchTextWithTimeout(redirectUrl, options.timeoutMs, cookieHeader, searchUrl);
      cookieHeader = redirectPage.cookieHeader;
      resolvedUrl = extractMpUrlFromSogouRedirectHtml(redirectPage.text);
    } catch (error) {
      console.warn(
        `[wechat_sogou] failed to resolve article for ${source.id}: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }

    if (!resolvedUrl) {
      continue;
    }
    if (seenUrls.has(resolvedUrl)) {
      continue;
    }
    seenUrls.add(resolvedUrl);

    const lead = item.summary.split(/[。.!?\n]/).filter(Boolean)[0]?.slice(0, 280) || item.title.slice(0, 280);
    articles.push({
      id: makeArticleId(source.id, resolvedUrl, item.title),
      title: item.title,
      url: resolvedUrl,
      sourceId: source.id,
      sourceName: source.name,
      sourceType: source.sourceType || "wechat",
      publishedAt: item.publishedAt,
      summaryRaw: item.summary,
      leadParagraph: lead,
      contentText: [item.title, item.summary, lead].filter(Boolean).join(" "),
      infoUrl: resolvedUrl,
      tags: [],
      primaryType: "",
      secondaryTypes: [],
    });
  }

  return articles;
}
