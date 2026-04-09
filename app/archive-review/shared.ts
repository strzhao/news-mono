import styles from "./page.module.css";

export type SearchParams = Record<string, string | string[] | undefined>;

export function pickString(input: string | string[] | undefined): string {
  if (Array.isArray(input)) {
    return String(input[0] || "").trim();
  }
  return String(input || "").trim();
}

export function dateShift(daysAgo: number, timezoneName: string): string {
  const now = new Date(Date.now() - daysAgo * 86_400_000);
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezoneName,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const [{ value: year }, , { value: month }, , { value: day }] = formatter.formatToParts(now);
  return `${year}-${month}-${day}`;
}

export function clampInt(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw || fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

export function normalizeQualityTier(raw: string): "high" | "general" | "all" {
  const value = String(raw || "")
    .trim()
    .toLowerCase();
  if (["high", "hq", "default"].includes(value)) return "high";
  if (["general", "normal", "common", "non_high"].includes(value)) return "general";
  return "all";
}

export function formatDateTime(value: string): string {
  if (!value) return "-";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    hour12: false,
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(parsed);
}

export function formatPercent(value: number): string {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return "0.00%";
  return `${(normalized * 100).toFixed(2)}%`;
}

export function compactJson(value: Record<string, string[]>): string {
  const parts = Object.entries(value || {})
    .map(([group, tags]) => {
      const items = (tags || []).filter(Boolean);
      if (!items.length) return "";
      return `${group}:${items.join(",")}`;
    })
    .filter(Boolean);
  return parts.join(" | ");
}

const CHANNEL_LABELS: Record<string, string> = {
  rss: "RSS",
  twitter: "Twitter/X",
  wechat: "微信",
  github: "GitHub",
};

export function channelLabel(ch: string): string {
  return CHANNEL_LABELS[ch] || ch;
}

export function buildPageHref(params: {
  tab?: string;
  from: string;
  to: string;
  qualityTier: "high" | "general" | "all";
  q: string;
  sourceId: string;
  sourceChannel: string;
  primaryType: string;
  limit: number;
  offset: number;
}): string {
  const query = new URLSearchParams();
  if (params.tab) query.set("tab", params.tab);
  query.set("from", params.from);
  query.set("to", params.to);
  query.set("quality_tier", params.qualityTier);
  if (params.q) query.set("q", params.q);
  if (params.sourceId) query.set("source_id", params.sourceId);
  if (params.sourceChannel) query.set("source_channel", params.sourceChannel);
  if (params.primaryType) query.set("primary_type", params.primaryType);
  query.set("limit", String(params.limit));
  query.set("offset", String(Math.max(0, params.offset)));
  return `/archive-review?${query.toString()}`;
}

export function worthClass(worth: string): string {
  if (worth === "必读") return styles.worthMust;
  if (worth === "可读") return styles.worthRead;
  return styles.worthSkip;
}
