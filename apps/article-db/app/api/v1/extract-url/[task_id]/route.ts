import { requireArticleDbAuth } from "@/lib/article-db/auth";
import { getExtractionTask } from "@/lib/infra/extraction-queue";
import { jsonResponse } from "@/lib/infra/route-utils";
import { buildUpstashClientOrNone } from "@/lib/infra/upstash";

export const runtime = "nodejs";
export const maxDuration = 30;
export const preferredRegion = ["sin1"];

export async function GET(
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

    return jsonResponse(200, { ok: true, task }, true);
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}
