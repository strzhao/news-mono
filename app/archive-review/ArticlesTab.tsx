import Link from "next/link";
import type { ArchivedArticleRow, PrimaryTypeStat, SourceOption } from "@/lib/article-db/types";
import type { ArticleContentData } from "./ArticleDrawer";
import { ArchiveButton, ArticleDrawerProvider, ArticleTitle } from "./ArticleDrawer";
import styles from "./page.module.css";
import { buildPageHref, channelLabel, compactJson, formatDateTime, worthClass } from "./shared";

interface ArticlesTabProps {
  from: string;
  to: string;
  qualityTier: "high" | "general" | "all";
  q: string;
  sourceId: string;
  sourceChannel: string;
  primaryType: string;
  limit: number;
  offset: number;
  result: { items: ArchivedArticleRow[]; total: number };
  sources: SourceOption[];
  typeStats: PrimaryTypeStat[];
  submitQualityFeedback: (formData: FormData) => Promise<void>;
  fetchArticleContent: (articleId: string) => Promise<ArticleContentData | null>;
}

export default function ArticlesTab({
  from,
  to,
  qualityTier,
  q,
  sourceId,
  sourceChannel,
  primaryType,
  limit,
  offset,
  result,
  sources,
  typeStats,
  submitQualityFeedback,
  fetchArticleContent,
}: ArticlesTabProps) {
  const total = result.total;
  const start = total ? offset + 1 : 0;
  const end = Math.min(total, offset + limit);

  const returnTo = buildPageHref({
    tab: "articles",
    from,
    to,
    qualityTier,
    q,
    sourceId,
    sourceChannel,
    primaryType,
    limit,
    offset,
  });

  const prevHref =
    offset > 0
      ? buildPageHref({
          tab: "articles",
          from,
          to,
          qualityTier,
          q,
          sourceId,
          sourceChannel,
          primaryType,
          limit,
          offset: Math.max(0, offset - limit),
        })
      : "";

  const nextHref =
    offset + limit < total
      ? buildPageHref({
          tab: "articles",
          from,
          to,
          qualityTier,
          q,
          sourceId,
          sourceChannel,
          primaryType,
          limit,
          offset: offset + limit,
        })
      : "";

  // Group sources by channel for select
  const sourcesByChannel = new Map<string, Array<{ id: string; name: string }>>();
  for (const s of sources) {
    const list = sourcesByChannel.get(s.source_channel) || [];
    list.push({ id: s.id, name: s.name });
    sourcesByChannel.set(s.source_channel, list);
  }

  return (
    <>
      {/* ── Filters ─────────────────────────────────── */}
      <form className={styles.filters} method="GET">
        <input type="hidden" name="tab" value="articles" />
        <label>
          从
          <input type="date" name="from" defaultValue={from} />
        </label>
        <label>
          到
          <input type="date" name="to" defaultValue={to} />
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
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
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

      {/* ── Article count ───────────────────────────── */}
      <p className={styles.articleCount}>
        显示 {start}-{end} / {total} 篇
      </p>

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
                    <span
                      className={
                        item.quality_tier === "high" ? styles.badgeHigh : styles.badgeGeneral
                      }
                    >
                      {item.quality_tier === "high" ? "高质量" : "一般"}
                    </span>
                  </div>

                  <div className={styles.cardMeta}>
                    <span className={styles.channelBadge} data-channel={item.source_channel}>
                      {channelLabel(item.source_channel)}
                    </span>
                    <span>{item.source_name}</span>
                    <span>{item.date}</span>
                    <span className={styles.cardMetaScore}>
                      {item.quality_score_snapshot.toFixed(1)}
                    </span>
                    {item.worth && (
                      <span className={`${styles.cardMetaWorth} ${worthClass(item.worth)}`}>
                        {item.worth}
                      </span>
                    )}
                  </div>

                  {item.one_line_summary ? (
                    <p className={styles.summary}>{item.one_line_summary}</p>
                  ) : null}

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
                    <ArchiveButton
                      articleId={item.article_id}
                      hasContent={item.has_content}
                      label="查看存档"
                      disabledLabel="无存档"
                    />
                  </div>

                  {/* Collapsible details */}
                  <details className={styles.cardDetails}>
                    <summary className={styles.detailsToggle} />
                    <div className={styles.detailsBody}>
                      <p className={styles.row}>
                        <strong>ID</strong> {item.article_id} · <strong>站点</strong>{" "}
                        {item.source_host || "-"} · <strong>来源 ID</strong> {item.source_id}
                      </p>
                      <p className={styles.row}>
                        <strong>归档日</strong> {item.date} · <strong>分析时间</strong>{" "}
                        {formatDateTime(item.analyzed_at)} · <strong>入选高质量</strong>{" "}
                        {item.is_selected ? "是" : "否"}
                      </p>
                      <p className={styles.row}>
                        <strong>质量分(快照)</strong> {item.quality_score_snapshot.toFixed(2)} ·{" "}
                        <strong>AI原始分</strong> {item.quality_score.toFixed(2)} ·{" "}
                        <strong>置信度</strong> {item.confidence.toFixed(3)}
                      </p>
                      <p className={styles.row}>
                        <strong>主类型</strong> {item.primary_type || "-"} · <strong>次类型</strong>{" "}
                        {(item.secondary_types || []).join(", ") || "-"}
                      </p>

                      {item.reason_short ? (
                        <p className={styles.reason}>理由：{item.reason_short}</p>
                      ) : null}
                      {item.action_hint ? (
                        <p className={styles.action}>建议：{item.action_hint}</p>
                      ) : null}

                      <p className={styles.row}>
                        <strong>影响度</strong> 公司 {item.company_impact.toFixed(1)} / 团队{" "}
                        {item.team_impact.toFixed(1)} / 个人 {item.personal_impact.toFixed(1)} /
                        执行清晰度 {item.execution_clarity.toFixed(1)}
                      </p>
                      <p className={styles.row}>
                        <strong>新颖度</strong> {item.novelty_score.toFixed(1)} ·{" "}
                        <strong>清晰度</strong> {item.clarity_score.toFixed(1)} ·{" "}
                        <strong>适合角色</strong> {(item.best_for_roles || []).join(", ") || "-"}
                      </p>
                      <p className={styles.row}>
                        <strong>证据信号</strong> {(item.evidence_signals || []).join(" | ") || "-"}
                      </p>
                      <p className={styles.row}>
                        <strong>标签组</strong> {tags || "-"}
                      </p>
                      <p className={styles.row}>
                        <strong>反馈统计</strong> 好 {item.feedback_good_count} · 不好{" "}
                        {item.feedback_bad_count} · 总计 {item.feedback_total_count} · 最近{" "}
                        {item.feedback_last || "-"} ({formatDateTime(item.feedback_last_at)})
                      </p>
                      <p className={styles.row}>
                        <strong>链接</strong>{" "}
                        <a
                          href={item.canonical_url || item.info_url || item.original_url}
                          target="_blank"
                          rel="noreferrer noopener"
                        >
                          canonical/info
                        </a>
                        {item.original_url &&
                        item.original_url !== (item.canonical_url || item.info_url) ? (
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
        {prevHref ? (
          <Link href={prevHref}>上一页</Link>
        ) : (
          <span className={styles.disabled}>上一页</span>
        )}
        {nextHref ? (
          <Link href={nextHref}>下一页</Link>
        ) : (
          <span className={styles.disabled}>下一页</span>
        )}
      </footer>
    </>
  );
}
