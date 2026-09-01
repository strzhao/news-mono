import { jsonResponse } from "@/lib/infra/route-utils";
import { listExpiredTaskIds } from "@/lib/infra/extraction-queue";
import { buildUpstashClientOrNone } from "@/lib/infra/upstash";

export const runtime = "nodejs";
export const maxDuration = 120;
export const preferredRegion = ["sin1"];

function isAuthorized(request: Request): boolean {
  const cronSecret = String(process.env.CRON_SECRET || "").trim();
  if (!cronSecret) return true;

  const vercelCron = String(request.headers.get("x-vercel-cron") || "").trim();
  if (vercelCron) return true;

  const authHeader = String(request.headers.get("authorization") || "").trim();
  return authHeader === `Bearer ${cronSecret}`;
}

export async function GET(request: Request): Promise<Response> {
  if (!isAuthorized(request)) {
    return jsonResponse(401, { ok: false, error: "unauthorized" }, true);
  }

  try {
    const redis = buildUpstashClientOrNone();
    if (!redis) {
      return jsonResponse(200, { ok: true, message: "Redis not configured, skipping cleanup", deleted: 0 }, true);
    }

    const expiredIds = await listExpiredTaskIds(redis);
    if (!expiredIds.length) {
      return jsonResponse(200, { ok: true, message: "No expired tasks", deleted: 0 }, true);
    }

    // TODO: When @vercel/blob is installed, delete actual blob files here.
    // For now, just remove expired task IDs from the completed set.
    for (const taskId of expiredIds) {
      await redis.command(["ZREM", "extraction:completed", taskId]);
    }

    return jsonResponse(200, {
      ok: true,
      message: `Cleaned up ${expiredIds.length} expired tasks`,
      deleted: expiredIds.length,
      task_ids: expiredIds,
    }, true);
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}
