import crypto from "node:crypto";
import { requireArticleDbAuth } from "@/lib/article-db/auth";
import { detectPlatform, requiresWorker } from "@/lib/domain/platform-detector";
import {
  DEFAULT_BLOB_TTL_HOURS,
  type ExtractedResource,
  type ExtractionTask,
} from "@/lib/domain/url-extraction-models";
import { fetchArticleContentSmart } from "@/lib/fetch/article-content-fetcher";
import { extractTwitterContent } from "@/lib/fetch/twitter-extractor";
import {
  enqueueExtractionTask,
  listPendingTasks,
  listUserTasks,
  saveCompletedTask,
} from "@/lib/infra/extraction-queue";
import { jsonResponse } from "@/lib/infra/route-utils";
import { buildUpstashClientOrNone } from "@/lib/infra/upstash";
import { generateArticleSummary } from "@/lib/llm/article-summary-generator";

export const runtime = "nodejs";
export const maxDuration = 120;
export const preferredRegion = ["sin1"];

/** Generate AI summary for extracted content; returns markdown or undefined on failure. */
async function tryGenerateAiSummary(
  task: ExtractionTask,
  extractedText?: string,
): Promise<string | undefined> {
  const contentText = extractedText || task.metadata.description || "";
  if (contentText.length < 50) return undefined;

  try {
    const result = await generateArticleSummary({
      articleId: task.task_id,
      title: task.metadata.title,
      url: task.url,
      contentFullText: contentText,
      contentText: "",
      summaryRaw: "",
      leadParagraph: "",
    });
    return result.markdown;
  } catch {
    return undefined;
  }
}

function generateTaskId(): string {
  return `ext_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`;
}

function isValidUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return ["http:", "https:"].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function extractMetaContent(html: string, property: string): string {
  const re = new RegExp(
    `<meta\\b[^>]*(?:property|name)\\s*=\\s*["']${property}["'][^>]*content\\s*=\\s*["']([^"']*)["']`,
    "i",
  );
  const match = re.exec(html);
  if (match) return String(match[1] || "").trim();

  const re2 = new RegExp(
    `<meta\\b[^>]*content\\s*=\\s*["']([^"']*)["'][^>]*(?:property|name)\\s*=\\s*["']${property}["']`,
    "i",
  );
  const match2 = re2.exec(html);
  return match2 ? String(match2[1] || "").trim() : "";
}

function extractTitle(html: string): string {
  const ogTitle = extractMetaContent(html, "og:title");
  if (ogTitle) return ogTitle;
  const titleMatch = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  return titleMatch ? String(titleMatch[1] || "").trim() : "";
}

async function extractWebpage(
  url: string,
  taskId: string,
  platform: string,
): Promise<ExtractionTask & { _extractedText?: string }> {
  const content = await fetchArticleContentSmart(url, {
    timeoutMs: 15_000,
    httpOnly: platform === "wechat",
  });

  if (content.text.length < 50) {
    throw new Error(
      `Extraction returned insufficient content (${content.text.length} chars) for ${url}`,
    );
  }

  const resources: ExtractedResource[] = [];

  // Text content
  if (content.text) {
    resources.push({
      type: "text",
      url: url,
      filename: "content.txt",
      size_bytes: content.text.length,
      mime_type: "text/plain",
    });
  }

  // Images
  for (const img of content.images) {
    resources.push({
      type: "image",
      url: img.url,
      filename: img.alt || `image_${resources.length}.jpg`,
      size_bytes: 0,
      mime_type: "image/jpeg",
    });
  }

  const ogDesc = extractMetaContent(content.html, "og:description");

  return {
    task_id: taskId,
    url,
    platform: "webpage",
    status: "completed",
    user_id: "",
    resources,
    metadata: {
      title: extractTitle(content.html) || url,
      description: ogDesc || content.text.slice(0, 300),
      author:
        extractMetaContent(content.html, "author") ||
        extractMetaContent(content.html, "og:site_name") ||
        "",
      published_at: extractMetaContent(content.html, "article:published_time") || undefined,
      tags: [],
    },
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    blob_ttl_hours: DEFAULT_BLOB_TTL_HOURS,
    _extractedText: content.text,
  };
}

async function extractTwitter(url: string, taskId: string): Promise<ExtractionTask> {
  const { resources, metadata } = await extractTwitterContent(url, taskId);

  return {
    task_id: taskId,
    url,
    platform: "twitter",
    status: "completed",
    user_id: "",
    resources,
    metadata,
    created_at: new Date().toISOString(),
    completed_at: new Date().toISOString(),
    blob_ttl_hours: DEFAULT_BLOB_TTL_HOURS,
  };
}

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireArticleDbAuth(request);
  if (unauthorized) {
    return jsonResponse(
      unauthorized.status,
      { ok: false, error: unauthorized.error, auth_mode: unauthorized.mode },
      true,
    );
  }

  try {
    const body = (await request.json()) as {
      url?: string;
      blob_ttl_hours?: number;
      user_id?: string;
      ai_summary?: boolean;
    };
    const url = String(body?.url || "").trim();
    if (!url || !isValidUrl(url)) {
      return jsonResponse(
        400,
        { ok: false, error: "invalid_url", message: "请提供有效的 URL" },
        true,
      );
    }

    const blobTtlHours = Math.max(
      1,
      Math.min(168, Number(body?.blob_ttl_hours) || DEFAULT_BLOB_TTL_HOURS),
    );
    const userId = String(body?.user_id || "").trim();
    const wantAiSummary = Boolean(body?.ai_summary);
    const taskId = generateTaskId();
    const platform = detectPlatform(url);

    // Webpage and Twitter can be extracted directly on Vercel
    if (platform === "webpage" || platform === "wechat") {
      const task = await extractWebpage(url, taskId, platform);
      task.platform = platform;
      task.user_id = userId;
      if (wantAiSummary) {
        task.ai_summary = await tryGenerateAiSummary(task, task._extractedText);
      }
      // Strip internal field before saving / returning
      const { _extractedText, ...cleanTask } = task;
      const redis = buildUpstashClientOrNone();
      if (redis && userId) {
        await saveCompletedTask(redis, cleanTask).catch(() => {});
      }
      return jsonResponse(200, { ok: true, task: cleanTask }, true);
    }

    if (platform === "twitter") {
      const task = await extractTwitter(url, taskId);
      task.user_id = userId;
      if (wantAiSummary) {
        task.ai_summary = await tryGenerateAiSummary(task);
      }
      const redis = buildUpstashClientOrNone();
      if (redis && userId) {
        await saveCompletedTask(redis, task).catch(() => {});
      }
      return jsonResponse(200, { ok: true, task }, true);
    }

    // Video/social platforms require the local worker
    if (requiresWorker(platform)) {
      const redis = buildUpstashClientOrNone();
      if (!redis) {
        return jsonResponse(
          503,
          { ok: false, error: "queue_unavailable", message: "Redis 未配置，无法创建异步提取任务" },
          true,
        );
      }

      const task: ExtractionTask = {
        task_id: taskId,
        url,
        platform,
        status: "pending",
        user_id: userId,
        resources: [],
        metadata: { title: "", description: "", author: "" },
        created_at: new Date().toISOString(),
        blob_ttl_hours: blobTtlHours,
      };

      await enqueueExtractionTask(redis, task);

      return jsonResponse(
        202,
        {
          ok: true,
          task: {
            task_id: taskId,
            url,
            platform,
            status: "pending",
            created_at: task.created_at,
            blob_ttl_hours: blobTtlHours,
          },
        },
        true,
      );
    }

    return jsonResponse(
      400,
      { ok: false, error: "unsupported_platform", message: `不支持的平台: ${platform}` },
      true,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const isExtractionFailure =
      message.includes("Extraction returned insufficient") || message.includes("Browser extract");
    return jsonResponse(
      isExtractionFailure ? 422 : 500,
      { ok: false, error: isExtractionFailure ? "extraction_failed" : "internal_error", message },
      true,
    );
  }
}

/** List pending tasks (for worker) or user tasks (for frontend). */
export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireArticleDbAuth(request);
  if (unauthorized) {
    return jsonResponse(unauthorized.status, { ok: false, error: unauthorized.error }, true);
  }

  try {
    const redis = buildUpstashClientOrNone();
    if (!redis) {
      return jsonResponse(200, { ok: true, tasks: [] }, true);
    }

    const url = new URL(request.url);
    const userId = String(url.searchParams.get("user_id") || "").trim();

    // If user_id provided, return that user's tasks
    if (userId) {
      const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit")) || 50));
      const tasks = await listUserTasks(redis, userId, limit);
      return jsonResponse(200, { ok: true, tasks }, true);
    }

    // Otherwise, list pending tasks for extraction worker
    const limit = Math.max(1, Math.min(20, Number(url.searchParams.get("limit")) || 5));
    const tasks = await listPendingTasks(redis, limit);

    return jsonResponse(200, { ok: true, tasks }, true);
  } catch (error) {
    return jsonResponse(
      500,
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      true,
    );
  }
}
