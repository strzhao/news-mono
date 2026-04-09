import { requireArticleDbAuth } from "@/lib/article-db/auth";
import type { ExtractedResource, ExtractionMetadata } from "@/lib/domain/url-extraction-models";
import { getExtractionTask, updateTaskStatus } from "@/lib/infra/extraction-queue";
import { jsonResponse } from "@/lib/infra/route-utils";
import { buildUpstashClientOrNone } from "@/lib/infra/upstash";

export const runtime = "nodejs";
export const maxDuration = 30;
export const preferredRegion = ["sin1"];

interface CompleteBody {
  resources?: ExtractedResource[];
  metadata?: ExtractionMetadata;
  error_message?: string;
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ task_id: string }> },
): Promise<Response> {
  const unauthorized = await requireArticleDbAuth(request);
  if (unauthorized) {
    return jsonResponse(unauthorized.status, { ok: false, error: unauthorized.error }, true);
  }

  try {
    const { task_id: taskId } = await params;
    const normalizedId = String(taskId || "").trim();
    if (!normalizedId) {
      return jsonResponse(400, { ok: false, error: "missing_task_id" }, true);
    }

    const redis = buildUpstashClientOrNone();
    if (!redis) {
      return jsonResponse(503, { ok: false, error: "redis_unavailable" }, true);
    }

    const task = await getExtractionTask(redis, normalizedId);
    if (!task) {
      return jsonResponse(404, { ok: false, error: "task_not_found" }, true);
    }

    const body = (await request.json()) as CompleteBody;
    const hasError = Boolean(body.error_message);
    const status = hasError ? "failed" : "completed";

    await updateTaskStatus(redis, normalizedId, status, {
      resources: body.resources,
      metadata: body.metadata,
      error_message: body.error_message,
    });

    // Track completion time for blob cleanup
    if (status === "completed") {
      await redis.zadd("extraction:completed", Date.now(), normalizedId);
    }

    return jsonResponse(200, { ok: true, task_id: normalizedId, status }, true);
  } catch (error) {
    return jsonResponse(
      500,
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      true,
    );
  }
}
