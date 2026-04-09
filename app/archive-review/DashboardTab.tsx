import type { AiEvalObservabilitySnapshot } from "@/lib/article-db/ai-observability";
import type {
  ChannelAnalyticsStat,
  ChannelStat,
  DailyTrendPoint,
  PrimaryTypeStat,
  SourceStat,
} from "@/lib/article-db/types";
import styles from "./page.module.css";
import { channelLabel, formatDateTime, formatPercent } from "./shared";

interface DashboardTabProps {
  from: string;
  to: string;
  channelStats: ChannelStat[];
  channelAnalytics: ChannelAnalyticsStat[];
  sourceStats: SourceStat[];
  dailyTrend: DailyTrendPoint[];
  typeStats: PrimaryTypeStat[];
  aiObs: AiEvalObservabilitySnapshot;
}

export default function DashboardTab({
  from,
  to,
  channelStats,
  channelAnalytics,
  sourceStats,
  dailyTrend,
  typeStats,
  aiObs,
}: DashboardTabProps) {
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
  const trendBarWidth =
    dailyTrend.length > 0 ? Math.max(4, Math.floor(500 / dailyTrend.length) - 2) : 10;
  const trendSvgWidth = dailyTrend.length * (trendBarWidth + 2);
  const trendSvgHeight = 80;

  // Source rank top 10
  const topSources = sourceStats.slice(0, 10);
  const topSourceMax = topSources[0]?.article_count || 1;

  // Type stats top 8
  const topTypes = typeStats.slice(0, 8);
  const topTypeMax = topTypes[0]?.count || 1;

  return (
    <>
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
            最近运行：{formatDateTime(latestRun.started_at)} · 状态 {latestRun.status} · 候选{" "}
            {latestRun.ai_eval_total_candidates} · 失败率{" "}
            {formatPercent(latestRun.ai_eval_failed_rate)} · 缓存命中率{" "}
            {formatPercent(latestRun.ai_eval_cache_hit_rate)}
          </p>
        ) : (
          <p className={styles.aiLatest}>暂无 ingestion 运行记录。</p>
        )}
        {samplePreview.length ? (
          <div className={styles.aiSamples}>
            {samplePreview.map((sample) => (
              <article
                key={`${sample.article_id}:${sample.error_type}`}
                className={styles.aiSample}
              >
                <p>
                  <strong>{sample.error_type}</strong> · {sample.article_id} ·{" "}
                  {sample.source_id || "-"}
                </p>
                <p>{sample.error_message || "-"}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className={styles.aiNoSample}>最近窗口内没有失败样本。</p>
        )}
      </section>

      {/* ── Channel Analytics (New) ──────────────────── */}
      <section className={styles.channelAnalyticsSection}>
        <h2>渠道分析</h2>
        <div className={styles.channelAnalyticsGrid}>
          {["rss", "twitter", "wechat", "github"].map((ch) => {
            const stat = channelAnalytics.find((c) => c.source_channel === ch);
            const count = stat?.analysis_count || 0;
            const successCount = stat?.analysis_success_count || 0;
            const highCount = stat?.high_quality_count || 0;
            const successRate = count > 0 ? successCount / count : 0;
            const highRate = count > 0 ? highCount / count : 0;
            return (
              <div key={ch} className={styles.channelAnalyticsCard} data-channel={ch}>
                <h3>{channelLabel(ch)}</h3>
                <dl>
                  <div>
                    <dt>分析数</dt>
                    <dd>{count}</dd>
                  </div>
                  <div>
                    <dt>分析成功率</dt>
                    <dd>{formatPercent(successRate)}</dd>
                  </div>
                  <div>
                    <dt>高质量占比</dt>
                    <dd>{formatPercent(highRate)}</dd>
                  </div>
                </dl>
              </div>
            );
          })}
        </div>
      </section>

      {/* ── Statistics Dashboard ────────────────────── */}
      <section className={styles.statsPanel}>
        <div className={styles.statsPanelHead}>
          <h2>数据总览</h2>
          <p>
            {from} ~ {to}
          </p>
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
                  <g
                    key={d.date}
                    aria-label={`${d.date}: ${d.article_count} 篇 (${d.high_count} 高质量)`}
                  >
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
    </>
  );
}
