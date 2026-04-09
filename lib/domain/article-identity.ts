import crypto from "node:crypto";

const GENERIC_TRACKING_PREFIXES = ["utm_", "spm", "fbclid", "gclid", "ref"];
const WECHAT_EPHEMERAL_PARAMS = new Set(["timestamp", "ver", "signature", "new", "scene", "clicktime", "enterid"]);
const WECHAT_STABLE_PARAMS = ["__biz", "mid", "idx", "sn"];
const NON_TEXT_RE = /[^\p{L}\p{N}]+/gu;

function boundedInt(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw || fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function isMpWechatUrl(raw: string): boolean {
  try {
    const parsed = new URL(raw);
    return parsed.hostname.toLowerCase() === "mp.weixin.qq.com" && parsed.pathname === "/s";
  } catch {
    return false;
  }
}

function hasWechatStableParams(parsed: URL): boolean {
  return WECHAT_STABLE_PARAMS.some((key) => String(parsed.searchParams.get(key) || "").trim());
}

export function normalizeArticleTitleKey(value: string): string {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(NON_TEXT_RE, " ")
    .trim();
}

export function normalizeArticleUrl(raw: string): string {
  try {
    const parsed = new URL(String(raw || "").trim());
    const entries: Array<[string, string]> = [];
    const isWechatMp = parsed.hostname.toLowerCase() === "mp.weixin.qq.com" && parsed.pathname === "/s";
    const keepStableWechatOnly = isWechatMp && hasWechatStableParams(parsed);

    parsed.searchParams.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (GENERIC_TRACKING_PREFIXES.some((prefix) => lower.startsWith(prefix))) return;
      if (keepStableWechatOnly) {
        if (!WECHAT_STABLE_PARAMS.includes(lower)) return;
      } else if (isWechatMp && WECHAT_EPHEMERAL_PARAMS.has(lower)) {
        return;
      }
      entries.push([key, value]);
    });

    entries.sort(([left], [right]) => left.localeCompare(right));
    const query = new URLSearchParams(entries);
    const pathname = parsed.pathname.replace(/\/$/, "") || "/";
    const normalized = new URL(parsed.toString());
    normalized.protocol = parsed.protocol.toLowerCase();
    normalized.hostname = parsed.hostname.toLowerCase();
    normalized.pathname = pathname;
    normalized.search = query.toString();
    normalized.hash = "";
    return normalized.toString();
  } catch {
    return String(raw || "").trim();
  }
}

export function formatDateInTimezone(date: Date, timezoneName: string): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezoneName,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [{ value: year }, , { value: month }, , { value: day }] = formatter.formatToParts(date);
  return `${year}-${month}-${day}`;
}

export function currentDateInTimezone(timezoneName: string, now: Date = new Date()): string {
  return formatDateInTimezone(now, timezoneName);
}

export function shiftIsoDate(date: string, deltaDays: number): string {
  const raw = String(date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new Error(`Invalid ISO date: ${raw}`);
  }
  const [year, month, day] = raw.split("-").map((part) => Number.parseInt(part, 10));
  const shifted = new Date(Date.UTC(year, month - 1, day + deltaDays));
  return shifted.toISOString().slice(0, 10);
}

export function getWechatFreshnessMaxAgeDays(raw: string, fallback = 3): number {
  return boundedInt(String(raw || fallback), fallback, 1, 30);
}

export function isPublishedWithinReportWindow(
  publishedAt: Date | null,
  reportDate: string,
  maxAgeDays: number,
  timezoneName: string,
): boolean {
  if (!publishedAt || !Number.isFinite(publishedAt.getTime())) {
    return false;
  }
  const publishedDate = formatDateInTimezone(publishedAt, timezoneName);
  const floorDate = shiftIsoDate(reportDate, -(Math.max(1, maxAgeDays) - 1));
  return publishedDate >= floorDate && publishedDate <= reportDate;
}

export function isWechatArticleIdentityCandidate(params: {
  sourceType?: string;
  sourceId?: string;
  url?: string;
  infoUrl?: string;
}): boolean {
  if (String(params.sourceType || "").trim().toLowerCase() === "wechat") {
    return true;
  }
  return isMpWechatUrl(String(params.url || params.infoUrl || ""));
}

export function buildArticleIdentityKey(params: {
  sourceId?: string;
  sourceType?: string;
  url?: string;
  infoUrl?: string;
  title?: string;
  publishedAt?: Date | null;
  summaryRaw?: string;
}): string {
  const rawUrl = String(params.url || params.infoUrl || "").trim();
  const normalizedUrl = normalizeArticleUrl(rawUrl);
  const isWechat = isWechatArticleIdentityCandidate(params);

  if (!isWechat) {
    return normalizedUrl;
  }

  if (rawUrl) {
    try {
      const parsed = new URL(rawUrl);
      if (parsed.hostname.toLowerCase() === "mp.weixin.qq.com" && parsed.pathname === "/s" && hasWechatStableParams(parsed)) {
        return normalizeArticleUrl(rawUrl);
      }
    } catch {
      // Ignore parse failures and fall back to title/timestamp key below.
    }
  }

  const sourceId = String(params.sourceId || "wechat").trim() || "wechat";
  const publishedAtKey =
    params.publishedAt && Number.isFinite(params.publishedAt.getTime()) ? params.publishedAt.toISOString() : "unknown";
  const titleKey = normalizeArticleTitleKey(params.title || "");
  const summaryKey = normalizeArticleTitleKey(String(params.summaryRaw || "").slice(0, 200));
  const fingerprint = crypto
    .createHash("sha256")
    .update([sourceId, publishedAtKey, titleKey || summaryKey || normalizedUrl].join("|"))
    .digest("hex")
    .slice(0, 24);

  return `wechat:${sourceId}:${publishedAtKey}:${fingerprint}`;
}
