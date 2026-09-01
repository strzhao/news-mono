/**
 * 小红书 content extraction via Playwright.
 *
 * XHS is a fully client-rendered SPA — HTTP fetch alone cannot retrieve note
 * content. We launch headless Chromium via Playwright, wait for the page to
 * render, then extract data from the live DOM / __INITIAL_STATE__.
 *
 * Flow:
 *   1. Launch headless Chromium (Playwright)
 *   2. Navigate to the note URL, wait for content to render
 *   3. Extract note data from __INITIAL_STATE__ (populated after JS execution)
 *   4. Download all images → upload to Vercel Blob
 *   5. For video notes → download video via direct URL or yt-dlp fallback
 *   6. Build text content → upload to Blob
 */
import { execFile } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { extname, join } from "node:path";
import { uploadBufferToBlob, uploadFileToBlob } from "../upload.js";
import { acquireBrowser, releasePage } from "./browser.js";
import { ytdlpProxyArgs } from "./youtube.js";

const XHS_STATE_FILE = join(homedir(), ".xhs-session", "state.json");

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

interface NoteData {
  title: string;
  desc: string;
  author: string;
  authorAvatar: string;
  noteId: string;
  tags: string[];
  time: number;
  likedCount: string;
  collectedCount: string;
  commentCount: string;
  shareCount: string;
  imageUrls: string[];
  videoUrl: string;
  videoCoverUrl: string;
  isVideo: boolean;
}

function computeExpiresAt(ttlHours: number): string {
  return new Date(Date.now() + ttlHours * 3600 * 1000).toISOString();
}

function exec(cmd: string, args: string[], cwd: string, timeoutMs = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { cwd, maxBuffer: 10 * 1024 * 1024, timeout: timeoutMs },
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

// Extract note ID from various XHS URL formats
function extractNoteId(url: string): string {
  const match = url.match(/(?:explore|discovery\/item)\/([a-f0-9]+)/i);
  if (match) return match[1];
  const segments = new URL(url).pathname.split("/").filter(Boolean);
  const last = segments[segments.length - 1] || "";
  if (/^[a-f0-9]{16,}$/i.test(last)) return last;
  return "";
}

// Download an image buffer with proper Referer header
async function downloadImage(imageUrl: string): Promise<Buffer | null> {
  try {
    const fullUrl = imageUrl.startsWith("//") ? `https:${imageUrl}` : imageUrl;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    const response = await fetch(fullUrl, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
        Referer: "https://www.xiaohongshu.com/",
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) return null;
    return Buffer.from(await response.arrayBuffer());
  } catch {
    return null;
  }
}

function guessImageMime(url: string): string {
  if (url.includes(".png")) return "image/png";
  if (url.includes(".webp")) return "image/webp";
  return "image/jpeg";
}

function guessImageExt(url: string): string {
  if (url.includes(".png")) return ".png";
  if (url.includes(".webp")) return ".webp";
  return ".jpg";
}

// Check if saved XHS session state exists
async function hasSessionState(): Promise<boolean> {
  try {
    await stat(XHS_STATE_FILE);
    return true;
  } catch {
    return false;
  }
}

// Use Playwright to load XHS page and extract note data from the rendered DOM
async function extractViaPlaywright(url: string, taskId: string): Promise<NoteData | null> {
  // Check for saved session state
  const hasState = await hasSessionState();
  if (!hasState) {
    console.log(
      `[${taskId}] No XHS session found. Run 'npx tsx src/xhs-login.ts' to log in first.`,
    );
  }

  const browser = await acquireBrowser();
  let context: Awaited<ReturnType<typeof browser.newContext>> | null = null;
  try {
    const contextOptions: Record<string, unknown> = {
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "zh-CN",
    };
    if (hasState) {
      contextOptions.storageState = XHS_STATE_FILE;
    }
    context = await browser.newContext(contextOptions);
    const page = await context.newPage();

    // Anti-detection: hide webdriver flag
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });

    // Navigate and wait for content to load
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });

    // Dismiss login popup if it appears (XHS shows modal overlay even with valid session)
    try {
      const closeBtn = await page.$(
        ".close-button, [class*=close], .login-modal [class*=close], [class*=modal] [class*=close]",
      );
      if (closeBtn) {
        await closeBtn.click();
        console.log(`[${taskId}] Dismissed login popup`);
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch {
      // no popup or close button — fine
    }

    // Wait for note content to appear (XHS renders note into #noteContainer or similar)
    try {
      await page.waitForSelector("#detail-desc, .note-text, .note-content, [class*=note-text]", {
        timeout: 15_000,
      });
    } catch {
      // Content selector not found, try waiting for __INITIAL_STATE__ to be populated
      console.log(`[${taskId}] Content selector not found, waiting for network idle...`);
      await page.waitForLoadState("networkidle").catch(() => {});
    }

    // Extract note data from the page
    const noteData = await page.evaluate((noteId: string) => {
      const result: any = {
        title: "",
        desc: "",
        author: "",
        authorAvatar: "",
        noteId: noteId,
        tags: [],
        time: 0,
        likedCount: "",
        collectedCount: "",
        commentCount: "",
        shareCount: "",
        imageUrls: [],
        videoUrl: "",
        videoCoverUrl: "",
        isVideo: false,
      };

      // Try __INITIAL_STATE__ first (now populated after JS execution)
      try {
        const state = (window as any).__INITIAL_STATE__;
        if (state?.note?.noteDetailMap) {
          const map = state.note.noteDetailMap;
          // Find the note - try noteId directly, or iterate
          let note = map[noteId]?.note;
          if (!note?.title) {
            // Try finding any populated note entry
            for (const key of Object.keys(map)) {
              const candidate = map[key]?.note;
              if (candidate?.title) {
                note = candidate;
                break;
              }
            }
          }
          if (note && (note.title || note.desc)) {
            result.title = note.title || "";
            result.desc = note.desc || "";
            result.author = note.user?.nickname || note.user?.nick_name || "";
            result.authorAvatar = note.user?.avatar || "";
            result.noteId = note.noteId || note.note_id || noteId;
            result.time = note.time || note.createTime || 0;

            // Tags
            const tagList = note.tagList || note.tag_list || [];
            result.tags = tagList.map((t: any) => t.name || "").filter(Boolean);

            // Interaction
            const interact = note.interactInfo || note.interact_info || {};
            result.likedCount = String(interact.likedCount || interact.liked_count || "");
            result.collectedCount = String(
              interact.collectedCount || interact.collected_count || "",
            );
            result.commentCount = String(interact.commentCount || interact.comment_count || "");
            result.shareCount = String(interact.shareCount || interact.share_count || "");

            // Images
            const imageList = note.imageList || note.image_list || [];
            result.imageUrls = imageList
              .map((img: any) => {
                return (
                  img.urlDefault || img.url_default || img.urlPre || img.url_pre || img.url || ""
                );
              })
              .filter(Boolean);

            // Video
            const video = note.video || {};
            if (
              video.consumer?.originVideoKey ||
              video.url ||
              video.media?.stream?.h264?.[0]?.masterUrl
            ) {
              result.isVideo = true;
              result.videoUrl =
                video.media?.stream?.h264?.[0]?.masterUrl ||
                video.consumer?.originVideoKey ||
                video.url ||
                "";
              result.videoCoverUrl = video.cover?.urlDefault || video.cover?.url || "";
            }

            return result;
          }
        }
      } catch (e) {
        console.log("__INITIAL_STATE__ extraction failed:", e);
      }

      // Fallback: extract from DOM
      try {
        // Title
        const titleEl = document.querySelector("#detail-title, .title, [class*=title]");
        if (titleEl) result.title = titleEl.textContent?.trim() || "";

        // Description/content
        const descEl = document.querySelector(
          "#detail-desc, .note-text, .desc, [class*=note-text], [class*=content]",
        );
        if (descEl) result.desc = descEl.textContent?.trim() || "";

        // Author
        const authorEl = document.querySelector(
          ".author-name, [class*=author-name], .user-name, [class*=username]",
        );
        if (authorEl) result.author = authorEl.textContent?.trim() || "";

        // Images from the note carousel/gallery
        const imgElements = document.querySelectorAll(
          ".swiper-slide img, .note-slider img, [class*=slide] img, .carousel img",
        );
        const urls: string[] = [];
        imgElements.forEach((img) => {
          const src = (img as HTMLImageElement).src || img.getAttribute("data-src") || "";
          if (src && !src.includes("avatar") && !src.includes("logo")) {
            urls.push(src);
          }
        });
        // Also try background-image on slide elements
        document.querySelectorAll(".swiper-slide, [class*=slide]").forEach((el) => {
          const bg = (el as HTMLElement).style.backgroundImage;
          const match = bg?.match(/url\(["']?(.+?)["']?\)/);
          if (match?.[1]) urls.push(match[1]);
        });
        if (urls.length > 0) {
          result.imageUrls = [...new Set(urls)];
        }

        // Tags from hashtag links
        document
          .querySelectorAll("a[href*='/search_result/'], .tag, [class*=hashtag]")
          .forEach((el) => {
            const text = el.textContent?.trim().replace(/^#/, "");
            if (text) result.tags.push(text);
          });

        // Video element
        const videoEl = document.querySelector("video");
        if (videoEl) {
          result.isVideo = true;
          result.videoUrl = videoEl.src || videoEl.querySelector("source")?.src || "";
        }
      } catch (e) {
        console.log("DOM extraction failed:", e);
      }

      return result;
    }, extractNoteId(url));

    if (!noteData || (!noteData.title && !noteData.desc && noteData.imageUrls.length === 0)) {
      return null;
    }
    return noteData as NoteData;
  } finally {
    if (context) await context.close().catch(() => {});
    releasePage();
  }
}

// Build readable text content
function buildTextContent(data: NoteData, metadata: ExtractionMetadata, url: string): string {
  const lines: string[] = [];
  if (metadata.title) lines.push(`# ${metadata.title}`, "");
  if (metadata.description) lines.push(metadata.description, "");
  lines.push("---");
  if (metadata.author) lines.push(`作者: ${metadata.author}`);
  if (metadata.published_at) lines.push(`发布时间: ${metadata.published_at}`);
  if (metadata.tags?.length) lines.push(`标签: ${metadata.tags.map((t) => `#${t}`).join(" ")}`);
  const parts: string[] = [];
  if (data.likedCount) parts.push(`点赞: ${data.likedCount}`);
  if (data.collectedCount) parts.push(`收藏: ${data.collectedCount}`);
  if (data.commentCount) parts.push(`评论: ${data.commentCount}`);
  if (parts.length) lines.push(parts.join(" | "));
  lines.push(`原始链接: ${url}`);
  return lines.join("\n");
}

export async function extractXiaohongshu(
  url: string,
  taskId: string,
  blobTtlHours: number,
): Promise<{ resources: ExtractedResource[]; metadata: ExtractionMetadata }> {
  const resources: ExtractedResource[] = [];
  const metadata: ExtractionMetadata = {
    title: "",
    description: "",
    author: "",
    tags: [],
  };
  const expiresAt = computeExpiresAt(blobTtlHours);
  const workDir = await mkdtemp(join(tmpdir(), "xhs-"));

  try {
    // === Primary: Playwright extraction ===
    let noteData: NoteData | null = null;
    try {
      console.log(`[${taskId}] Launching Playwright for XHS extraction...`);
      noteData = await extractViaPlaywright(url, taskId);
      if (noteData) {
        console.log(
          `[${taskId}] Playwright extracted: title="${noteData.title}", images=${noteData.imageUrls.length}, isVideo=${noteData.isVideo}`,
        );
      } else {
        console.log(`[${taskId}] Playwright: no note data found`);
      }
    } catch (err) {
      console.log(
        `[${taskId}] Playwright extraction failed: ${err instanceof Error ? err.message : err}`,
      );
    }

    if (noteData && (noteData.title || noteData.desc || noteData.imageUrls.length > 0)) {
      // Populate metadata
      metadata.title = noteData.title;
      metadata.description = noteData.desc;
      metadata.author = noteData.author;
      metadata.platform_id = noteData.noteId || extractNoteId(url);
      metadata.tags = noteData.tags;
      if (noteData.time) {
        metadata.published_at = new Date(Number(noteData.time)).toISOString();
      }

      // Download and upload all images
      if (noteData.imageUrls.length > 0) {
        console.log(`[${taskId}] Downloading ${noteData.imageUrls.length} images...`);
        const CONCURRENCY = 5;
        for (let i = 0; i < noteData.imageUrls.length; i += CONCURRENCY) {
          const batch = noteData.imageUrls.slice(i, i + CONCURRENCY);
          const results = await Promise.allSettled(
            batch.map(async (imgUrl, batchIdx) => {
              const idx = i + batchIdx;
              const buffer = await downloadImage(imgUrl);
              if (!buffer || buffer.length < 100) return null;
              const filename = `image_${idx + 1}${guessImageExt(imgUrl)}`;
              const uploaded = await uploadBufferToBlob(taskId, buffer, filename, "image");
              return {
                type: "image",
                url: uploaded.url,
                filename: uploaded.filename,
                size_bytes: uploaded.size_bytes,
                mime_type: guessImageMime(imgUrl),
                expires_at: expiresAt,
              } as ExtractedResource;
            }),
          );
          for (const result of results) {
            if (result.status === "fulfilled" && result.value) {
              resources.push(result.value);
            }
          }
        }
        console.log(
          `[${taskId}] Downloaded ${resources.filter((r) => r.type === "image").length}/${noteData.imageUrls.length} images`,
        );
      }

      // Handle video notes
      if (noteData.isVideo) {
        // Try direct video URL download first
        if (noteData.videoUrl?.startsWith("http")) {
          try {
            console.log(`[${taskId}] Downloading video from direct URL...`);
            const buffer = await downloadImage(noteData.videoUrl); // reuse download fn
            if (buffer && buffer.length > 1000) {
              const uploaded = await uploadBufferToBlob(taskId, buffer, "video.mp4", "video");
              resources.push({
                type: "video",
                url: uploaded.url,
                filename: "video.mp4",
                size_bytes: uploaded.size_bytes,
                mime_type: "video/mp4",
                expires_at: expiresAt,
              });
            }
          } catch {
            console.log(`[${taskId}] Direct video download failed, trying yt-dlp...`);
          }
        }

        // Fallback to yt-dlp for video if direct download didn't work
        if (!resources.some((r) => r.type === "video")) {
          try {
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
              const type = [".mp4", ".webm", ".mkv"].includes(ext) ? "video" : "thumbnail";
              const uploaded = await uploadFileToBlob(taskId, filePath, type);
              resources.push({
                type,
                url: uploaded.url,
                filename: file,
                size_bytes: uploaded.size_bytes,
                mime_type: ext === ".mp4" ? "video/mp4" : "image/jpeg",
                expires_at: expiresAt,
              });
            }
          } catch {
            console.log(`[${taskId}] yt-dlp video download also failed`);
          }
        }
      }

      // Upload text content
      try {
        const textContent = buildTextContent(noteData, metadata, url);
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
    } else {
      console.log(`[${taskId}] No data from Playwright, extraction incomplete`);
    }

    return { resources, metadata };
  } finally {
    await rm(workDir, { recursive: true, force: true }).catch(() => {});
  }
}
