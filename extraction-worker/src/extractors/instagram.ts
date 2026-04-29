/**
 * Instagram content extraction via Playwright.
 *
 * Instagram (2026) requires login to view ANY posts, even public ones.
 * Strategy:
 *   1. Playwright + saved session → intercept GraphQL response or extract from DOM
 *   2. yt-dlp fallback for video content
 *
 * Prerequisites:
 *   - Run `npm run ig-login` once to save session to ~/.instagram-session/state.json
 *
 * Supports: single image, single video, Reel, Carousel (multi-image/video).
 */
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { extname, join } from "node:path";
import { uploadBufferToBlob, uploadFileToBlob } from "../upload.js";
import { acquireBrowser, releasePage } from "./browser.js";
import { ytdlpProxyArgs } from "./youtube.js";

interface ExtractedResource {
  type: string;
  url: string;
  filename: string;
  size_bytes: number;
  mime_type: string;
  expires_at?: string;
}

interface ExtractionMetadata {
  title: string;
  description: string;
  author: string;
  tags?: string[];
  platform_id?: string;
  published_at?: string;
}

interface MediaItem {
  type: "image" | "video";
  url: string;
  coverUrl?: string;
  width?: number;
  height?: number;
}

interface PostData {
  shortcode: string;
  caption: string;
  author: string;
  authorFullName: string;
  timestamp: number;
  likeCount: number;
  commentCount: number;
  viewCount: number;
  mediaItems: MediaItem[];
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const IG_SESSION_FILE = join(homedir(), ".instagram-session", "state.json");

function computeExpiresAt(ttlHours: number): string {
  return new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
}

function exec(cmd: string, args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd, maxBuffer: 10 * 1024 * 1024, timeout: 120_000 },
      (error, stdout, stderr) => {
        if (error) {
          reject(new Error(`${cmd} failed: ${error.message}\nstderr: ${stderr}`));
          return;
        }
        resolve(stdout);
      },
    );
  });
}

function extractShortcode(url: string): string {
  const match = url.match(/(?:\/p\/|\/reel\/|\/reels\/|\/tv\/)([A-Za-z0-9_-]+)/);
  return match?.[1] || "";
}

function extractHashtags(text: string): string[] {
  const matches = text.match(/#[\w\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+/g);
  if (!matches) return [];
  return Array.from(new Set(matches.map((t) => t.replace("#", "")))).slice(0, 20);
}

async function downloadMedia(mediaUrl: string): Promise<Buffer | null> {
  try {
    const fullUrl = mediaUrl.startsWith("//") ? `https:${mediaUrl}` : mediaUrl;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);
    const response = await fetch(fullUrl, {
      headers: { "User-Agent": UA, Referer: "https://www.instagram.com/" },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

function guessMime(url: string, type: "image" | "video"): string {
  if (type === "video") return url.includes(".webm") ? "video/webm" : "video/mp4";
  if (url.includes(".png")) return "image/png";
  if (url.includes(".webp")) return "image/webp";
  return "image/jpeg";
}

function guessExt(url: string, type: "image" | "video"): string {
  if (type === "video") return url.includes(".webm") ? ".webm" : ".mp4";
  if (url.includes(".png")) return ".png";
  if (url.includes(".webp")) return ".webp";
  return ".jpg";
}

async function hasSessionState(): Promise<boolean> {
  try {
    await stat(IG_SESSION_FILE);
    return true;
  } catch {
    return false;
  }
}

// Parse media items from a GraphQL shortcode_media node
function parseMediaNode(node: any): MediaItem[] {
  const items: MediaItem[] = [];

  // Carousel / Sidecar
  const sidecar = node.edge_sidecar_to_children || node.carousel_media;
  if (sidecar) {
    const edges = sidecar.edges || sidecar;
    const list = Array.isArray(edges) ? edges : [];
    for (const edge of list) {
      const child = edge.node || edge;
      if (child.is_video && (child.video_url || child.video_versions)) {
        items.push({
          type: "video",
          url: child.video_url || child.video_versions?.[0]?.url || "",
          coverUrl: child.display_url || child.image_versions2?.candidates?.[0]?.url,
          width: child.dimensions?.width || child.original_width,
          height: child.dimensions?.height || child.original_height,
        });
      } else {
        const imgUrl = child.display_url || child.image_versions2?.candidates?.[0]?.url || "";
        if (imgUrl) {
          items.push({
            type: "image",
            url: imgUrl,
            width: child.dimensions?.width || child.original_width,
            height: child.dimensions?.height || child.original_height,
          });
        }
      }
    }
    return items;
  }

  // Single video
  if (node.is_video && (node.video_url || node.video_versions)) {
    items.push({
      type: "video",
      url: node.video_url || node.video_versions?.[0]?.url || "",
      coverUrl: node.display_url || node.image_versions2?.candidates?.[0]?.url,
      width: node.dimensions?.width || node.original_width,
      height: node.dimensions?.height || node.original_height,
    });
    return items;
  }

  // Single image
  const imgUrl = node.display_url || node.image_versions2?.candidates?.[0]?.url || "";
  if (imgUrl) {
    items.push({
      type: "image",
      url: imgUrl,
      width: node.dimensions?.width || node.original_width,
      height: node.dimensions?.height || node.original_height,
    });
  }

  return items;
}

function parseGraphQLMedia(media: any): PostData | null {
  if (!media) return null;

  const caption = media.edge_media_to_caption?.edges?.[0]?.node?.text || media.caption?.text || "";
  const owner = media.owner || media.user || {};

  return {
    shortcode: media.shortcode || media.code || "",
    caption,
    author: owner.username || "",
    authorFullName: owner.full_name || "",
    timestamp: media.taken_at_timestamp || media.taken_at || 0,
    likeCount: media.edge_media_preview_like?.count || media.like_count || 0,
    commentCount: media.edge_media_to_comment?.count || media.comment_count || 0,
    viewCount: media.video_view_count || media.play_count || 0,
    mediaItems: parseMediaNode(media),
  };
}

// ===== Tier 1: Playwright with session =====
async function extractViaPlaywright(
  url: string,
  shortcode: string,
  taskId: string,
): Promise<PostData | null> {
  const hasState = await hasSessionState();
  if (!hasState) {
    console.log(`[${taskId}] No Instagram session found. Run 'npm run ig-login' first.`);
  }

  const browser = await acquireBrowser();
  let context: Awaited<ReturnType<typeof browser.newContext>> | null = null;
  try {
    const contextOptions: Record<string, unknown> = {
      userAgent: UA,
      locale: "en-US",
    };
    if (hasState) {
      contextOptions.storageState = IG_SESSION_FILE;
    }
    context = await browser.newContext(contextOptions);

    // Intercept GraphQL responses for structured data
    let capturedMedia: any = null;
    const page = await context.newPage();

    // Anti-detection: hide webdriver flag
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });

    page.on("response", async (response) => {
      try {
        const respUrl = response.url();
        if (
          respUrl.includes("/api/graphql") ||
          respUrl.includes("/graphql/query") ||
          respUrl.includes("/api/v1/media/")
        ) {
          const json = await response.json().catch(() => null);
          if (!json) return;

          // GraphQL response
          const media = json?.data?.xdt_shortcode_media || json?.data?.shortcode_media;
          if (media?.shortcode || media?.code) {
            capturedMedia = media;
            return;
          }

          // API v1 response (media info)
          const items = json?.items;
          if (Array.isArray(items) && items.length > 0) {
            capturedMedia = items[0];
            return;
          }
        }
      } catch {
        // ignore
      }
    });

    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

    // Wait for content — Instagram 2026 uses obfuscated class names
    try {
      await page.waitForSelector(
        "video, img[alt]:not([alt*='profile picture']), [role='presentation']",
        { timeout: 15_000 },
      );
    } catch {
      await page.waitForLoadState("networkidle").catch(() => {});
    }

    // Give extra time for GraphQL response to arrive
    await new Promise((r) => setTimeout(r, 5000));

    // If we captured GraphQL/API data, use it
    if (capturedMedia) {
      console.log(`[${taskId}] Playwright: captured API response`);
      return parseGraphQLMedia(capturedMedia);
    }

    // Fallback: extract from DOM
    console.log(`[${taskId}] Playwright: extracting from DOM...`);
    const domData = await page.evaluate(() => {
      const result: any = {
        caption: "",
        author: "",
        imageUrls: [] as string[],
        videoUrl: "",
        timestamp: 0,
      };

      // Author — find the first username link in the post header area
      // Instagram post header shows: [avatar] username [Verified] [Following] [...]
      // The username link href is /{username}/ and has short text matching the path
      const allLinks = document.querySelectorAll("a[role='link']");
      for (let i = 0; i < allLinks.length; i++) {
        const a = allLinks[i];
        const href = a.getAttribute("href") || "";
        const text = a.textContent?.trim() || "";
        const match = href.match(/^\/([a-zA-Z0-9_.]+)\/$/);
        if (match && text === match[1]) {
          result.author = text;
          break;
        }
      }

      // Caption — find text near the author or containing hashtags
      // Strategy: find span elements that contain hashtag links or are near the author link
      const hashtagLink = document.querySelector("a[href*='/explore/tags/']");
      if (hashtagLink) {
        // Walk up to find the caption container
        let container: Element | null = hashtagLink;
        for (let i = 0; i < 5 && container; i++) {
          container = container.parentElement;
          const text = container?.textContent?.trim() || "";
          // Caption container should have reasonable length and not include comment text
          if (text.length > 20 && text.length < 3000) {
            result.caption = text;
            break;
          }
        }
      }
      if (!result.caption) {
        // Fallback: look for OG description meta tag
        const ogDesc = document.querySelector("meta[property='og:description']");
        const desc = ogDesc?.getAttribute("content") || "";
        // OG description format: "N likes, N comments - Author on Instagram: ..."
        const ogMatch = desc.match(/on Instagram:\s*["""](.+)["""]$/);
        result.caption = ogMatch ? ogMatch[1] : desc;
      }
      // Clean caption: remove author prefix if present
      if (result.author && result.caption.startsWith(result.author)) {
        result.caption = result.caption
          .slice(result.author.length)
          .replace(/^[\s·Verified\d\w]*(?:d|h|m|w)\s*/i, "")
          .trim();
      }

      // Images — only content images (large width, not profile pics, not comment avatars)
      const imgs = document.querySelectorAll("img");
      const urls: string[] = [];
      imgs.forEach((img) => {
        const src = (img as HTMLImageElement).src;
        const alt = (img as HTMLImageElement).alt || "";
        const width = (img as HTMLImageElement).width || 0;
        const height = (img as HTMLImageElement).height || 0;
        // Content images: large, not profile pics, not tiny icons
        if (
          src?.includes("cdninstagram.com") &&
          width > 300 &&
          height > 300 &&
          !alt.includes("profile picture") &&
          !alt.includes("'s profile")
        ) {
          urls.push(src);
        }
      });
      result.imageUrls = Array.from(new Set(urls));

      // Video
      const videoEl = document.querySelector("video");
      if (videoEl) {
        result.videoUrl = (videoEl as HTMLVideoElement).src || "";
        if (!result.videoUrl) {
          const source = videoEl.querySelector("source");
          if (source) result.videoUrl = source.src || "";
        }
      }

      // Timestamp
      const timeEl = document.querySelector("time[datetime]");
      if (timeEl) {
        const dt = timeEl.getAttribute("datetime");
        if (dt) result.timestamp = Math.floor(new Date(dt).getTime() / 1000);
      }

      return result;
    });

    // Build PostData from DOM
    const mediaItems: MediaItem[] = [];
    if (domData.videoUrl) {
      mediaItems.push({ type: "video", url: domData.videoUrl, coverUrl: domData.imageUrls[0] });
    }
    for (const imgUrl of domData.imageUrls) {
      if (!domData.videoUrl || imgUrl !== domData.imageUrls[0]) {
        mediaItems.push({ type: "image", url: imgUrl });
      }
    }

    if (mediaItems.length === 0 && !domData.caption) return null;

    return {
      shortcode,
      caption: domData.caption || "",
      author: domData.author || "",
      authorFullName: "",
      timestamp: domData.timestamp || 0,
      likeCount: 0,
      commentCount: 0,
      viewCount: 0,
      mediaItems,
    };
  } finally {
    if (context) await context.close().catch(() => {});
    releasePage();
  }
}

function buildTextContent(data: PostData, metadata: ExtractionMetadata, url: string): string {
  const lines: string[] = [];
  if (metadata.title) lines.push(`# ${metadata.title}`, "");
  if (metadata.description && metadata.description !== metadata.title) {
    lines.push(metadata.description, "");
  }
  lines.push("---");
  if (metadata.author)
    lines.push(
      `Author: ${data.authorFullName ? `${data.authorFullName} (@${metadata.author})` : `@${metadata.author}`}`,
    );
  if (metadata.published_at) lines.push(`Published: ${metadata.published_at}`);
  if (metadata.tags?.length) lines.push(`Tags: ${metadata.tags.map((t) => `#${t}`).join(" ")}`);
  const parts: string[] = [];
  if (data.likeCount) parts.push(`Likes: ${data.likeCount}`);
  if (data.commentCount) parts.push(`Comments: ${data.commentCount}`);
  if (data.viewCount) parts.push(`Views: ${data.viewCount}`);
  if (parts.length) lines.push(parts.join(" | "));
  lines.push(`Source: ${url}`);
  return lines.join("\n");
}

export async function extractInstagram(
  url: string,
  taskId: string,
  blobTtlHours: number,
): Promise<{ resources: ExtractedResource[]; metadata: ExtractionMetadata }> {
  const resources: ExtractedResource[] = [];
  let metadata: ExtractionMetadata = {
    title: "Instagram Post",
    description: "",
    author: "",
    tags: [],
  };
  const expiresAt = computeExpiresAt(blobTtlHours);
  const workDir = await mkdtemp(join(tmpdir(), "insta-"));
  const shortcode = extractShortcode(url);

  try {
    let postData: PostData | null = null;

    // === Tier 1: Playwright with session ===
    try {
      console.log(`[${taskId}] Launching Playwright for Instagram extraction...`);
      postData = await extractViaPlaywright(url, shortcode, taskId);
      if (postData) {
        console.log(
          `[${taskId}] Playwright extracted: caption=${postData.caption.length}ch, media=${postData.mediaItems.length}, author=${postData.author}`,
        );
      } else {
        console.log(`[${taskId}] Playwright: no post data found`);
      }
    } catch (err) {
      console.log(`[${taskId}] Playwright failed: ${err instanceof Error ? err.message : err}`);
    }

    // Process extracted data
    if (postData && (postData.caption || postData.mediaItems.length > 0)) {
      const caption = postData.caption;
      metadata = {
        title: caption.slice(0, 200) || "Instagram Post",
        description: caption,
        author: postData.author,
        platform_id: postData.shortcode || shortcode,
        tags: extractHashtags(caption),
        published_at: postData.timestamp
          ? new Date(postData.timestamp * 1000).toISOString()
          : undefined,
      };

      // Download and upload media
      const CONCURRENCY = 5;
      let imageIdx = 0;
      let videoIdx = 0;

      for (let i = 0; i < postData.mediaItems.length; i += CONCURRENCY) {
        const batch = postData.mediaItems.slice(i, i + CONCURRENCY);
        const results = await Promise.allSettled(
          batch.map(async (item) => {
            const buffer = await downloadMedia(item.url);
            if (!buffer || buffer.length < 100) return null;

            if (item.type === "video") {
              const idx = videoIdx++;
              const filename = `video_${idx + 1}${guessExt(item.url, "video")}`;
              const uploaded = await uploadBufferToBlob(taskId, buffer, filename, "video");
              const res: ExtractedResource = {
                type: "video",
                url: uploaded.url,
                filename: uploaded.filename,
                size_bytes: uploaded.size_bytes,
                mime_type: guessMime(item.url, "video"),
                expires_at: expiresAt,
              };

              // Download video cover
              if (item.coverUrl) {
                const coverBuf = await downloadMedia(item.coverUrl);
                if (coverBuf && coverBuf.length > 100) {
                  const coverName = `cover_${idx + 1}.jpg`;
                  const coverUploaded = await uploadBufferToBlob(
                    taskId,
                    coverBuf,
                    coverName,
                    "image",
                  );
                  return [
                    res,
                    {
                      type: "image",
                      url: coverUploaded.url,
                      filename: coverUploaded.filename,
                      size_bytes: coverUploaded.size_bytes,
                      mime_type: "image/jpeg",
                      expires_at: expiresAt,
                    } as ExtractedResource,
                  ];
                }
              }
              return [res];
            } else {
              const idx = imageIdx++;
              const filename = `image_${idx + 1}${guessExt(item.url, "image")}`;
              const uploaded = await uploadBufferToBlob(taskId, buffer, filename, "image");
              return [
                {
                  type: "image",
                  url: uploaded.url,
                  filename: uploaded.filename,
                  size_bytes: uploaded.size_bytes,
                  mime_type: guessMime(item.url, "image"),
                  expires_at: expiresAt,
                } as ExtractedResource,
              ];
            }
          }),
        );

        for (const result of results) {
          if (result.status === "fulfilled" && result.value) {
            const items = Array.isArray(result.value) ? result.value : [result.value];
            resources.push(...items);
          }
        }
      }

      console.log(
        `[${taskId}] Downloaded ${resources.length} resources from ${postData.mediaItems.length} media items`,
      );

      // Upload text content
      try {
        const textContent = buildTextContent(postData, metadata, url);
        const textBuffer = Buffer.from(textContent, "utf-8");
        const uploaded = await uploadBufferToBlob(taskId, textBuffer, "content.txt", "text");
        resources.push({
          type: "text",
          url: uploaded.url,
          filename: "content.txt",
          size_bytes: uploaded.size_bytes,
          mime_type: "text/plain",
          expires_at: expiresAt,
        });
      } catch {
        console.log(`[${taskId}] Text upload failed (non-fatal)`);
      }
    }

    // === Tier 2: yt-dlp fallback ===
    const _hasVideo = resources.some((r) => r.type === "video");
    const hasAnyMedia = resources.some((r) => r.type === "image" || r.type === "video");
    if (!hasAnyMedia) {
      try {
        console.log(`[${taskId}] Trying yt-dlp fallback...`);
        await exec(
          "yt-dlp",
          [
            "--cookies-from-browser",
            "chrome",
            ...ytdlpProxyArgs(url),
            "-f",
            "best",
            "--write-thumbnail",
            "--no-playlist",
            "-o",
            "%(title).80s.%(ext)s",
            url,
          ],
          workDir,
        );

        const files = await readdir(workDir);
        for (const file of files) {
          const filePath = join(workDir, file);
          const fileStat = await stat(filePath);
          if (!fileStat.isFile()) continue;

          const ext = extname(file).toLowerCase();
          let type = "image";
          let mimeType = "image/jpeg";
          if ([".mp4", ".webm"].includes(ext)) {
            type = "video";
            mimeType = ext === ".mp4" ? "video/mp4" : "video/webm";
          } else if ([".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
            mimeType = ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
          }

          const uploaded = await uploadFileToBlob(taskId, filePath, type);
          resources.push({
            type,
            url: uploaded.url,
            filename: file,
            size_bytes: uploaded.size_bytes,
            mime_type: mimeType,
            expires_at: expiresAt,
          });
        }

        // Get metadata from yt-dlp if we don't have it
        if (metadata.title === "Instagram Post") {
          try {
            const metaJson = await exec(
              "yt-dlp",
              [
                "--cookies-from-browser",
                "chrome",
                ...ytdlpProxyArgs(url),
                "--dump-json",
                "--no-download",
                url,
              ],
              workDir,
            );
            const meta = JSON.parse(metaJson);
            metadata.title = String(meta.title || meta.description || "Instagram Post").slice(
              0,
              200,
            );
            metadata.description =
              metadata.description || String(meta.description || "").slice(0, 2000);
            metadata.author = metadata.author || String(meta.uploader || meta.channel || "");
            metadata.platform_id = metadata.platform_id || String(meta.id || "");
          } catch {
            // ignore
          }
        }
      } catch {
        console.log(`[${taskId}] yt-dlp fallback also failed`);
      }
    }

    return { resources, metadata };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
