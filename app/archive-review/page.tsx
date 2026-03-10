import Link from "next/link";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { buildAiEvalObservabilitySnapshot } from "@/lib/article-db/ai-observability";
import { authBridgeEnabled } from "@/lib/article-db/auth";
import {
  GATEWAY_SESSION_COOKIE_NAME,
  verifyGatewaySessionCookieValue,
} from "@/lib/article-db/auth-gateway-session";
import { listRecentIngestionRuns } from "@/lib/article-db/ingestion-runs";
import {
  getArchiveDailyTrend,
  getArchiveStatsByChannel,
  getArchiveStatsByPrimaryType,
  getArchiveStatsBySource,
  getHighQualityArticleDetail,
  listActiveSources,
  listArchivedArticles,
  recordArticleQualityFeedback,
} from "@/lib/article-db/repository";
import { ArticleDrawerProvider, ArticleTitle } from "./ArticleDrawer";
import type { ArticleContentData } from "./ArticleDrawer";
import styles from "./page.module.css";

export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

function pickString(input: string | string[] | undefined): string {
  if (Array.isArray(input)) {
    return String(input[0] || "").trim();
  }
  return String(input || "").trim();
}

function dateShift(daysAgo: number, timezoneName: string): string {
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

function clampInt(raw: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(raw || fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(parsed, max));
}

function normalizeQualityTier(raw: string): "high" | "general" | "all" {
  const value = String(raw || "").trim().toLowerCase();
  if (["high", "hq", "default"].includes(value)) return "high";
  if (["general", "normal", "common", "non_high"].includes(value)) return "general";
  return "all";
}

function formatDateTime(value: string): string {
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

function formatPercent(value: number): string {
  const normalized = Number(value);
  if (!Number.isFinite(normalized)) return "0.00%";
  return `${(normalized * 100).toFixed(2)}%`;
}

function compactJson(value: Record<string, string[]>): string {
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

function channelLabel(ch: string): string {
  return CHANNEL_LABELS[ch] || ch;
}

function buildPageHref(params: {
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

async function submitQualityFeedback(formData: FormData): Promise<void> {
  "use server";

  const articleId = String(formData.get("article_id") || "").trim();
  const feedback = String(formData.get("feedback") || "").trim().toLowerCase();
  const returnTo = String(formData.get("return_to") || "/archive-review").trim() || "/archive-review";
  if (!articleId || !["good", "bad"].includes(feedback)) {
    return;
  }

  await recordArticleQualityFeedback({
    articleId,
    feedback,
    source: "archive_review_page",
    contextJson: {
      return_to: returnTo,
      feedback,
    },
  });

  revalidatePath("/archive-review");
}

async function fetchArticleContent(articleId: string): Promise<ArticleContentData | null> {
  "use server";

  const detail = await getHighQualityArticleDetail(articleId);
  if (!detail) return null;
  return {
    title: detail.title,
    content_full_html: detail.content_full_html,
    content_full_text: detail.content_full_text,
    content_text: detail.content_text,
    summary_raw: detail.summary_raw,
    lead_paragraph: detail.lead_paragraph,
    original_url: detail.original_url,
    info_url: detail.info_url,
    canonical_url: detail.canonical_url,
  };
}

function worthClass(worth: string): string {
  if (worth === "必读") return styles.worthMust;
  if (worth === "可读") return styles.worthRead;
  return styles.worthSkip;
}

export default async function ArchiveReviewPage(props: {
  searchParams?: Promise<SearchParams>;
}): Promise<React.ReactNode> {
  const resolvedSearchParams = (await props.searchParams) || {};
  const nextQuery = new URLSearchParams();
  Object.entries(resolvedSearchParams).forEach(([key, value]) => {
    const picked = Array.isArray(value) ? value[0] : value;
    const normalized = String(picked || "").trim();
    if (normalized) {
      nextQuery.set(key, normalized);
    }
  });
  const nextPath = nextQuery.toString() ? `/archive-review?${nextQuery.toString()}` : "/archive-review";

  if (authBridgeEnabled()) {
    const cookieStore = await cookies();
    const gatewayRaw = String(cookieStore.get(GATEWAY_SESSION_COOKIE_NAME)?.value || "").trim();
    const gatewaySession = verifyGatewaySessionCookieValue(gatewayRaw);
    if (!gatewaySession) {
      redirect(`/auth/start?next=${encodeURIComponent(nextPath)}`);
    }
  }

  const timezoneName = String(process.env.DIGEST_TIMEZONE || "Asia/Shanghai").trim() || "Asia/Shanghai";
  const from = pickString(resolvedSearchParams.from) || dateShift(29, timezoneName);
  const to = pickString(resolvedSearchParams.to) || dateShift(0, timezoneName);
  const q = pickString(resolvedSearchParams.q).slice(0, 160);
  const sourceId = pickString(resolvedSearchParams.source_id).slice(0, 80);
  const sourceChannel = pickString(resolvedSearchParams.source_channel).slice(0, 40);
  const primaryType = pickString(resolvedSearchParams.primary_type).slice(0, 80);
  const qualityTier = normalizeQualityTier(pickString(resolvedSearchParams.quality_tier));
  const limit = clampInt(pickString(resolvedSearchParams.limit), 80, 10, 200);
  const offset = clampInt(pickString(resolvedSearchParams.offset), 0, 0, 20_000);

  const normalizedFrom = from <= to ? from : to;
  const normalizedTo = from <= to ? to : from;
  const returnTo = buildPageHref({
    from: normalizedFrom,
    to: normalizedTo,
    qualityTier,
    q,
    sourceId,
    sourceChannel,
    primaryType,
    limit,
    offset,
  });

  const [result, recentRuns, sources, channelStats, sourceStats, dailyTrend, typeStats] = await Promise.all([
    listArchivedArticles({
      fromDate: normalizedFrom,
      toDate: normalizedTo,
      limit,
      offset,
      qualityTier,
      search: q || undefined,
      sourceId: sourceId || undefined,
      sourceChannel: sourceChannel || undefined,
      primaryType: primaryType || undefined,
    }),
    listRecentIngestionRuns({
      days: 2,
      limit: 24,
    }),
    listActiveSources(),
    getArchiveStatsByChannel(normalizedFrom, normalizedTo),
    getArchiveStatsBySource(normalizedFrom, normalizedTo),
    getArchiveDailyTrend(normalizedFrom, normalizedTo),
    getArchiveStatsByPrimaryType(normalizedFrom, normalizedTo),
  ]);

  const aiObs = buildAiEvalObservabilitySnapshot(recentRuns);
  const latestRun = aiObs.runs[0] || null;
  const samplePreview = aiObs.latest_failed_samples.slice(0, 3);

  // KPI calculations
  const totalArticles = channelStats.reduce((s, c) => s + c.article_count, 0);
  const totalHighQuality = sourceStats.reduce((s, c) => s + c.high_count, 0);
  const activeSources = sourceStats.length;
  const dayCount = dailyTrend.length || 1;
  const avgPerDay = (totalArticles / dayCount).toFixed(1);

  // Trend chart SVG
  const trendMaxCount = Math.max(...dailyTrend.map((d) => d.article_count), 1);
  const trendBarWidth = dailyTrend.length > 0 ? Math.max(4, Math.floor(500 / dailyTrend.length) - 2) : 10;
  const trendSvgWidth = dailyTrend.length * (trendBarWidth + 2);
  const trendSvgHeight = 80;

  // Source rank top 10
  const topSources = sourceStats.slice(0, 10);
  const topSourceMax = topSources[0]?.article_count || 1;

  // Type stats top 8
  const topTypes = typeStats.slice(0, 8);
  const topTypeMax = topTypes[0]?.count || 1;

  // Group sources by channel for select
  const sourcesByChannel = new Map<string, Array<{ id: string; name: string }>>();
  for (const s of sources) {
    const list = sourcesByChannel.get(s.source_channel) || [];
    list.push({ id: s.id, name: s.name });
    sourcesByChannel.set(s.source_channel, list);
  }

  const total = result.total;
  const start = total ? offset + 1 : 0;
  const end = Math.min(total, offset + limit);
  const prevHref = offset > 0 ? buildPageHref({
    from: normalizedFrom,
    to: normalizedTo,
    qualityTier,
    q,
    sourceId,
    sourceChannel,
    primaryType,
    limit,
    offset: Math.max(0, offset - limit),
  }) : "";
  const nextHref = offset + limit < total ? buildPageHref({
    from: normalizedFrom,
    to: normalizedTo,
    qualityTier,
    q,
    sourceId,
    sourceChannel,
    primaryType,
    limit,
    offset: offset + limit,
  }) : "";

  return (
    <main className={styles.shell}>
      {/* ── Hero ────────────────────────────────────── */}
      <header className={styles.hero}>
        <div>
          <p className={styles.eyebrow}>Archive Review Console</p>
          <h1>归档文章审查与反馈</h1>
          <p className={styles.meta}>
            时间范围 {normalizedFrom} ~ {normalizedTo} · 显示 {start}-{end} / {total}
          </p>
        </div>
        <Link href="/" className={styles.homeLink}>
          返回首页
        </Link>
      </header>

      {/* ── AI Observability ────────────────────────── */}
      <section className={styles.aiPanel}>
        <div className={styles.aiPanelHead}>
          <h2>AI 分析可观测</h2>
          <p>最近 48 小时运行窗口</p>
        </div>
        <div className={styles.aiStatsGrid}>
          <div className={styles.aiStat}>
            <span>运行数</span>
            <strong>{aiObs.summary.run_count}</strong>
          </div>
          <div className={styles.aiStat}>
            <span>运行成功率</span>
            <strong>{formatPercent(aiObs.summary.run_success_rate)}</strong>
          </div>
          <div className={styles.aiStat}>
            <span>AI 失败率(均值)</span>
            <strong>{formatPercent(aiObs.summary.ai_eval_failed_rate_avg)}</strong>
          </div>
          <div className={styles.aiStat}>
            <span>缓存命中率(均值)</span>
            <strong>{formatPercent(aiObs.summary.ai_eval_cache_hit_rate_avg)}</strong>
          </div>
          <div className={styles.aiStat}>
            <span>AI p90 延迟</span>
            <strong>{aiObs.summary.ai_eval_latency_p90_ms_avg}ms</strong>
          </div>
          <div className={styles.aiStat}>
            <span>AI 评估成功/失败</span>
            <strong>
              {aiObs.summary.ai_eval_total_success}/{aiObs.summary.ai_eval_total_failed}
            </strong>
          </div>
        </div>
        {latestRun ? (
          <p className={styles.aiLatest}>
            最近运行：{formatDateTime(latestRun.started_at)} · 状态 {latestRun.status} · 候选 {latestRun.ai_eval_total_candidates} ·
            失败率 {formatPercent(latestRun.ai_eval_failed_rate)} · 缓存命中率 {formatPercent(latestRun.ai_eval_cache_hit_rate)}
          </p>
        ) : (
          <p className={styles.aiLatest}>暂无 ingestion 运行记录。</p>
        )}
        {samplePreview.length ? (
          <div className={styles.aiSamples}>
            {samplePreview.map((sample) => (
              <article key={`${sample.article_id}:${sample.error_type}`} className={styles.aiSample}>
                <p>
                  <strong>{sample.error_type}</strong> · {sample.article_id} · {sample.source_id || "-"}
                </p>
                <p>{sample.error_message || "-"}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.aiNoSample}>最近窗口内没有失败样本。</p>
        )}
      </section>

      {/* ── Statistics Dashboard ────────────────────── */}
      <section className={styles.statsPanel}>
        <div className={styles.statsPanelHead}>
          <h2>数据总览</h2>
          <p>{normalizedFrom} ~ {normalizedTo}</p>
        </div>

        {/* KPI overview */}
        <div className={styles.kpiGrid}>
          <div className={styles.kpiCard}>
            <span>总文章数</span>
            <strong>{totalArticles}</strong>
          </div>
          <div className={styles.kpiCard}>
            <span>高质量文章</span>
            <strong>{totalHighQuality}</strong>
          </div>
          <div className={styles.kpiCard}>
            <span>活跃来源</span>
            <strong>{activeSources}</strong>
          </div>
          <div className={styles.kpiCard}>
            <span>日均文章</span>
            <strong>{avgPerDay}</strong>
          </div>
        </div>

        {/* Channel distribution */}
        <div className={styles.channelGrid}>
          {["rss", "twitter", "wechat", "github"].map((ch) => {
            const stat = channelStats.find((c) => c.source_channel === ch);
            const count = stat?.article_count || 0;
            const pct = totalArticles > 0 ? ((count / totalArticles) * 100).toFixed(1) : "0.0";
            return (
              <div key={ch} className={styles.channelCard} data-channel={ch}>
                <span>{channelLabel(ch)}</span>
                <strong>
                  {count}
                  <span className={styles.channelPct}>{pct}%</span>
                </strong>
              </div>
            );
          })}
        </div>

        {/* Source rank + Daily trend */}
        <div className={styles.statsColumns}>
          <div className={styles.sourceRank}>
            <h3>来源排行 Top 10</h3>
            {topSources.map((s) => {
              const pct = (s.article_count / topSourceMax) * 100;
              const highPct = s.article_count > 0 ? (s.high_count / s.article_count) * 100 : 0;
              return (
                <div key={s.source_id} className={styles.sourceBarRow}>
                  <span className={styles.sourceBarLabel} title={s.source_name}>
                    {s.source_name}
                  </span>
                  <div className={styles.sourceBarTrack}>
                    <div className={styles.sourceBarFill} style={{ width: `${pct}%` }} />
                    <div className={styles.sourceBarFillHigh} style={{ width: `${highPct}%` }} />
                  </div>
                  <span className={styles.sourceBarCount}>
                    {s.article_count} / {s.high_count}
                  </span>
                </div>
              );
            })}
          </div>

          <div className={styles.trendChart}>
            <h3>每日文章趋势</h3>
            <svg
              className={styles.trendSvg}
              viewBox={`0 0 ${trendSvgWidth} ${trendSvgHeight}`}
              preserveAspectRatio="none"
            >
              {dailyTrend.map((d, i) => {
                const x = i * (trendBarWidth + 2);
                const totalH = (d.article_count / trendMaxCount) * (trendSvgHeight - 14);
                const highH = (d.high_count / trendMaxCount) * (trendSvgHeight - 14);
                return (
                  <g key={d.date} aria-label={`${d.date}: ${d.article_count} 篇 (${d.high_count} 高质量)`}>
                    <rect
                      x={x}
                      y={trendSvgHeight - totalH}
                      width={trendBarWidth}
                      height={totalH}
                      rx={2}
                      fill="#93c5fd"
                    />
                    <rect
                      x={x}
                      y={trendSvgHeight - highH}
                      width={trendBarWidth}
                      height={highH}
                      rx={2}
                      fill="#3b82f6"
                    />
                  </g>
                );
              })}
            </svg>
          </div>
        </div>

        {/* Type distribution */}
        {topTypes.length > 0 && (
          <div className={styles.typeGrid}>
            <h3>文章类型分布</h3>
            {topTypes.map((t) => {
              const pct = (t.count / topTypeMax) * 100;
              return (
                <div key={t.primary_type} className={styles.typeRow}>
                  <span className={styles.typeLabel}>{t.primary_type}</span>
                  <div className={styles.typeBarTrack}>
                    <div className={styles.typeBarFill} style={{ width: `${pct}%` }} />
                  </div>
                  <span className={styles.typeCount}>{t.count}</span>
                </div>
              );
            })}
          </div>
        )}
      </section>

      {/* ── Filters ─────────────────────────────────── */}
      <form className={styles.filters} method="GET">
        <label>
          从
          <input type="date" name="from" defaultValue={normalizedFrom} />
        </label>
        <label>
          到
          <input type="date" name="to" defaultValue={normalizedTo} />
        </label>
        <label>
          质量层
          <select name="quality_tier" defaultValue={qualityTier}>
            <option value="all">全部</option>
            <option value="high">高质量</option>
            <option value="general">一般质量</option>
          </select>
        </label>
        <label>
          关键词
          <input type="text" name="q" defaultValue={q} placeholder="标题/摘要/理由/链接" />
        </label>
        <label>
          频道
          <select name="source_channel" defaultValue={sourceChannel}>
            <option value="">全部频道</option>
            <option value="rss">RSS</option>
            <option value="twitter">Twitter/X</option>
            <option value="wechat">微信</option>
            <option value="github">GitHub</option>
          </select>
        </label>
        <label>
          来源
          <select name="source_id" defaultValue={sourceId}>
            <option value="">全部来源</option>
            {Array.from(sourcesByChannel.entries()).map(([ch, list]) => (
              <optgroup key={ch} label={channelLabel(ch)}>
                {list.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          文章类型
          <select name="primary_type" defaultValue={primaryType}>
            <option value="">全部类型</option>
            {typeStats.map((t) => (
              <option key={t.primary_type} value={t.primary_type}>
                {t.primary_type} ({t.count})
              </option>
            ))}
          </select>
        </label>
        <div className={styles.filtersActions}>
          <label>
            每页
            <select name="limit" defaultValue={String(limit)}>
              <option value="40">40</option>
              <option value="80">80</option>
              <option value="120">120</option>
              <option value="200">200</option>
            </select>
          </label>
          <input type="hidden" name="offset" value="0" />
          <button type="submit">筛选</button>
        </div>
      </form>

      {/* ── Article List ────────────────────────────── */}
      <ArticleDrawerProvider fetchContent={fetchArticleContent}>
      <section className={styles.list}>
        {result.items.length ? (
          result.items.map((item) => {
            const tags = compactJson(item.tag_groups);
            return (
              <article key={`${item.date}:${item.article_id}`} className={styles.card}>
                {/* Primary layer */}
                <div className={styles.cardHead}>
                  <h2>
                    <ArticleTitle articleId={item.article_id}>
                      {item.title || "无标题"}
                    </ArticleTitle>
                  </h2>
                  <span className={item.quality_tier === "high" ? styles.badgeHigh : styles.badgeGeneral}>
                    {item.quality_tier === "high" ? "高质量" : "一般"}
                  </span>
                </div>

                <div className={styles.cardMeta}>
                  <span className={styles.channelBadge} data-channel={item.source_channel}>
                    {channelLabel(item.source_channel)}
                  </span>
                  <span>{item.source_name}</span>
                  <span>{item.date}</span>
                  <span className={styles.cardMetaScore}>{item.quality_score_snapshot.toFixed(1)}</span>
                  {item.worth && (
                    <span className={`${styles.cardMetaWorth} ${worthClass(item.worth)}`}>{item.worth}</span>
                  )}
                </div>

                {item.one_line_summary ? <p className={styles.summary}>{item.one_line_summary}</p> : null}

                <div className={styles.feedbackBar}>
                  <form action={submitQualityFeedback}>
                    <input type="hidden" name="article_id" value={item.article_id} />
                    <input type="hidden" name="feedback" value="good" />
                    <input type="hidden" name="return_to" value={returnTo} />
                    <button type="submit" className={styles.goodBtn}>
                      好
                    </button>
                  </form>
                  <form action={submitQualityFeedback}>
                    <input type="hidden" name="article_id" value={item.article_id} />
                    <input type="hidden" name="feedback" value="bad" />
                    <input type="hidden" name="return_to" value={returnTo} />
                    <button type="submit" className={styles.badBtn}>
                      不好
                    </button>
                  </form>
                  {item.feedback_total_count > 0 && (
                    <span className={styles.feedbackInfo}>
                      {item.feedback_good_count}/{item.feedback_bad_count}
                    </span>
                  )}
                </div>

                {/* Collapsible details */}
                <details className={styles.cardDetails}>
                  <summary className={styles.detailsToggle} />
                  <div className={styles.detailsBody}>
                    <p className={styles.row}>
                      <strong>ID</strong> {item.article_id} · <strong>站点</strong> {item.source_host || "-"} ·{" "}
                      <strong>来源 ID</strong> {item.source_id}
                    </p>
                    <p className={styles.row}>
                      <strong>归档日</strong> {item.date} · <strong>分析时间</strong> {formatDateTime(item.analyzed_at)} ·{" "}
                      <strong>入选高质量</strong> {item.is_selected ? "是" : "否"}
                    </p>
                    <p className={styles.row}>
                      <strong>质量分(快照)</strong> {item.quality_score_snapshot.toFixed(2)} · <strong>AI原始分</strong>{" "}
                      {item.quality_score.toFixed(2)} · <strong>置信度</strong> {item.confidence.toFixed(3)}
                    </p>
                    <p className={styles.row}>
                      <strong>主类型</strong> {item.primary_type || "-"} ·{" "}
                      <strong>次类型</strong> {(item.secondary_types || []).join(", ") || "-"}
                    </p>

                    {item.reason_short ? <p className={styles.reason}>理由：{item.reason_short}</p> : null}
                    {item.action_hint ? <p className={styles.action}>建议：{item.action_hint}</p> : null}

                    <p className={styles.row}>
                      <strong>影响度</strong> 公司 {item.company_impact.toFixed(1)} / 团队 {item.team_impact.toFixed(1)} / 个人{" "}
                      {item.personal_impact.toFixed(1)} / 执行清晰度 {item.execution_clarity.toFixed(1)}
                    </p>
                    <p className={styles.row}>
                      <strong>新颖度</strong> {item.novelty_score.toFixed(1)} · <strong>清晰度</strong>{" "}
                      {item.clarity_score.toFixed(1)} · <strong>适合角色</strong> {(item.best_for_roles || []).join(", ") || "-"}
                    </p>
                    <p className={styles.row}>
                      <strong>证据信号</strong> {(item.evidence_signals || []).join(" | ") || "-"}
                    </p>
                    <p className={styles.row}>
                      <strong>标签组</strong> {tags || "-"}
                    </p>
                    <p className={styles.row}>
                      <strong>反馈统计</strong> 好 {item.feedback_good_count} · 不好 {item.feedback_bad_count} · 总计{" "}
                      {item.feedback_total_count} · 最近 {item.feedback_last || "-"} ({formatDateTime(item.feedback_last_at)})
                    </p>
                    <p className={styles.row}>
                      <strong>链接</strong>{" "}
                      <a href={item.canonical_url || item.info_url || item.original_url} target="_blank" rel="noreferrer noopener">
                        canonical/info
                      </a>
                      {item.original_url && item.original_url !== (item.canonical_url || item.info_url) ? (
                        <>
                          {" · "}
                          <a href={item.original_url} target="_blank" rel="noreferrer noopener">
                            原始来源
                          </a>
                        </>
                      ) : null}
                    </p>
                  </div>
                </details>
              </article>
            );
          })
        ) : (
          <p className={styles.empty}>当前筛选条件下没有归档文章。</p>
        )}
      </section>
      </ArticleDrawerProvider>

      <footer className={styles.pager}>
        {prevHref ? <Link href={prevHref}>上一页</Link> : <span className={styles.disabled}>上一页</span>}
        {nextHref ? <Link href={nextHref}>下一页</Link> : <span className={styles.disabled}>下一页</span>}
      </footer>
    </main>
  );
}
