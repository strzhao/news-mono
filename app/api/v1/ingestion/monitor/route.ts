import { checkIngestionHealth, formatIngestionAlert } from "@/lib/article-db/ingestion-monitor";
import { listRecentIngestionRuns } from "@/lib/article-db/ingestion-runs";
import { jsonResponse } from "@/lib/infra/route-utils";
import { AiTodoClient } from "@/lib/integrations/ai-todo-client";

export const runtime = "nodejs";
export const maxDuration = 30;
export const preferredRegion = ["sin1"];

function isAuthorized(request: Request, url: URL): boolean {
  const cronSecret = String(process.env.CRON_SECRET || "").trim();
  if (!cronSecret) return true;

  const vercelCron = String(request.headers.get("x-vercel-cron") || "").trim();
  if (vercelCron) return true;

  const authHeader = String(request.headers.get("authorization") || "").trim();
  if (authHeader === `Bearer ${cronSecret}`) return true;

  const token = String(url.searchParams.get("token") || "").trim();
  return token === cronSecret;
}

function boundedInt(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (!isAuthorized(request, url)) {
    return jsonResponse(401, { ok: false, error: "unauthorized" }, true);
  }

  const thresholdHours = boundedInt(
    url.searchParams.get("threshold_hours") ||
      String(process.env.INGESTION_MONITOR_THRESHOLD_HOURS || "4"),
    4,
    1,
    48,
  );
  const days = boundedInt(url.searchParams.get("days") || "1", 1, 1, 7);
  const shouldAlert = !["0", "false", "no", "off"].includes(
    String(url.searchParams.get("alert") || "true")
      .trim()
      .toLowerCase(),
  );

  try {
    const runs = await listRecentIngestionRuns({ days, limit: 24 });
    const result = checkIngestionHealth(runs, thresholdHours);

    let alertSent = false;
    let alertError: string | null = null;

    if (!result.healthy && shouldAlert) {
      const todoUrl = String(process.env.AI_TODO_API_URL || "").trim();
      const todoSpaceId = String(process.env.AI_TODO_SPACE_ID || "").trim();
      const todoToken = String(process.env.AI_TODO_SPACE_TOKEN || "").trim();
      if (todoUrl && todoSpaceId && todoToken) {
        try {
          const client = new AiTodoClient(todoUrl, todoSpaceId, todoToken);
          const payload = formatIngestionAlert(result);
          await client.createNote(payload);
          alertSent = true;
        } catch (err) {
          alertError = err instanceof Error ? err.message : String(err);
        }
      }
    }

    return jsonResponse(
      result.healthy ? 200 : 503,
      {
        ok: true,
        healthy: result.healthy,
        generated_at: result.checkedAt,
        last_success_at: result.lastSuccessAt || null,
        last_run_at: result.lastRunAt || null,
        hours_since_last_success: result.hoursSinceLastSuccess,
        hours_since_last_run: result.hoursSinceLastRun,
        threshold_hours: result.thresholdHours,
        total_runs_checked: result.totalRunsChecked,
        success_count: result.successCount,
        failed_count: result.failedCount,
        running_count: result.runningCount,
        alert_sent: alertSent,
        alert_error: alertError,
      },
      true,
    );
  } catch (error) {
    return jsonResponse(
      500,
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      true,
    );
  }
}
