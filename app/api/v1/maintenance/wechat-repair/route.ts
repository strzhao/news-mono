import { repairWechatDailyArchives } from "@/lib/article-db/repository";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = ["sin1"];

function queryValue(url: URL, key: string): string {
  return String(url.searchParams.get(key) || "").trim();
}

function isAuthorized(request: Request, url: URL): boolean {
  const authHeader = String(request.headers.get("authorization") || "").trim();
  const bearerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7).trim() : "";
  const queryToken = queryValue(url, "token");
  const accepted = [process.env.CRON_SECRET, process.env.ARTICLE_DB_API_TOKEN]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  if (!accepted.length) {
    return true;
  }
  return accepted.includes(bearerToken) || accepted.includes(queryToken);
}

function normalizeDate(raw: string, fallback = ""): string {
  const value = String(raw || fallback).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date: ${value}`);
  }
  return value;
}

function boundedInt(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw || fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  if (!isAuthorized(request, url)) {
    return jsonResponse(401, { ok: false, error: "Unauthorized" }, true);
  }

  try {
    const fromDate = normalizeDate(queryValue(url, "from"));
    const toDate = normalizeDate(queryValue(url, "to"));
    const timezoneName =
      queryValue(url, "tz") ||
      String(process.env.DIGEST_TIMEZONE || "Asia/Shanghai").trim() ||
      "Asia/Shanghai";
    const maxAgeDays = boundedInt(queryValue(url, "max_age_days") || "3", 3, 1, 30);

    const result = await repairWechatDailyArchives({
      fromDate,
      toDate,
      timezoneName,
      maxAgeDays,
    });

    return jsonResponse(200, { ok: true, ...result }, true);
  } catch (error) {
    return jsonResponse(
      500,
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      true,
    );
  }
}
