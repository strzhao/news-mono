import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import Link from "next/link";
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
  getChannelAnalytics,
  getHighQualityArticleDetail,
  listActiveSources,
  listArchivedArticles,
  recordArticleQualityFeedback,
} from "@/lib/article-db/repository";
import type { ArticleContentData } from "./ArticleDrawer";
import ArticlesTab from "./ArticlesTab";
import DashboardTab from "./DashboardTab";
import styles from "./page.module.css";
import { clampInt, dateShift, normalizeQualityTier, pickString, type SearchParams } from "./shared";

export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = ["sin1"];
export const dynamic = "force-dynamic";

async function submitQualityFeedback(formData: FormData): Promise<void> {
  "use server";

  const articleId = String(formData.get("article_id") || "").trim();
  const feedback = String(formData.get("feedback") || "")
    .trim()
    .toLowerCase();
  const returnTo =
    String(formData.get("return_to") || "/archive-review").trim() || "/archive-review";
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
    content_full_updated_at: detail.content_full_updated_at,
    content_full_error: detail.content_full_error,
    content_text: detail.content_text,
    summary_raw: detail.summary_raw,
    lead_paragraph: detail.lead_paragraph,
    original_url: detail.original_url,
    info_url: detail.info_url,
    canonical_url: detail.canonical_url,
  };
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
  const nextPath = nextQuery.toString()
    ? `/archive-review?${nextQuery.toString()}`
    : "/archive-review";

  if (authBridgeEnabled()) {
    const cookieStore = await cookies();
    const gatewayRaw = String(cookieStore.get(GATEWAY_SESSION_COOKIE_NAME)?.value || "").trim();
    const gatewaySession = verifyGatewaySessionCookieValue(gatewayRaw);
    if (!gatewaySession) {
      redirect(`/auth/start?next=${encodeURIComponent(nextPath)}`);
    }
  }

  // Parse params
  const activeTab = pickString(resolvedSearchParams.tab) === "articles" ? "articles" : "dashboard";
  const timezoneName =
    String(process.env.DIGEST_TIMEZONE || "Asia/Shanghai").trim() || "Asia/Shanghai";
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

  // Conditional data fetching based on active tab
  const [
    result,
    recentRuns,
    sources,
    channelStats,
    channelAnalytics,
    sourceStats,
    dailyTrend,
    typeStats,
  ] = await Promise.all([
    activeTab === "articles"
      ? listArchivedArticles({
          fromDate: normalizedFrom,
          toDate: normalizedTo,
          limit,
          offset,
          qualityTier,
          search: q || undefined,
          sourceId: sourceId || undefined,
          sourceChannel: sourceChannel || undefined,
          primaryType: primaryType || undefined,
        })
      : Promise.resolve({ items: [], total: 0 }),
    activeTab === "dashboard"
      ? listRecentIngestionRuns({ days: 2, limit: 24 })
      : Promise.resolve([]),
    listActiveSources(),
    activeTab === "dashboard"
      ? getArchiveStatsByChannel(normalizedFrom, normalizedTo)
      : Promise.resolve([]),
    activeTab === "dashboard"
      ? getChannelAnalytics(normalizedFrom, normalizedTo)
      : Promise.resolve([]),
    activeTab === "dashboard"
      ? getArchiveStatsBySource(normalizedFrom, normalizedTo)
      : Promise.resolve([]),
    activeTab === "dashboard"
      ? getArchiveDailyTrend(normalizedFrom, normalizedTo)
      : Promise.resolve([]),
    getArchiveStatsByPrimaryType(normalizedFrom, normalizedTo),
  ]);

  const aiObs = activeTab === "dashboard" ? buildAiEvalObservabilitySnapshot(recentRuns) : null;

  // Tab href helpers — preserve date range across tabs
  const dashboardHref = `/archive-review?tab=dashboard&from=${normalizedFrom}&to=${normalizedTo}`;
  const articlesHref = `/archive-review?tab=articles&from=${normalizedFrom}&to=${normalizedTo}`;

  return (
    <main className={styles.shell}>
      {/* ── Compact Header ──────────────────────────── */}
      <header className={styles.headerCompact}>
        <div className={styles.headerLeft}>
          <h1 className={styles.headerTitle}>归档审查台</h1>
          <span className={styles.headerMeta}>
            {normalizedFrom} ~ {normalizedTo}
          </span>
        </div>
        <Link href="/" className={styles.homeLink}>
          返回首页
        </Link>
      </header>

      {/* ── Tab Bar ─────────────────────────────────── */}
      <nav className={styles.tabBar}>
        <a
          href={dashboardHref}
          className={activeTab === "dashboard" ? styles.tabActive : styles.tab}
        >
          统计看板
        </a>
        <a href={articlesHref} className={activeTab === "articles" ? styles.tabActive : styles.tab}>
          文章列表
        </a>
      </nav>

      {/* ── Tab Content ─────────────────────────────── */}
      {activeTab === "dashboard" ? (
        <DashboardTab
          from={normalizedFrom}
          to={normalizedTo}
          channelStats={channelStats}
          channelAnalytics={channelAnalytics}
          sourceStats={sourceStats}
          dailyTrend={dailyTrend}
          typeStats={typeStats}
          aiObs={aiObs!}
        />
      ) : (
        <ArticlesTab
          from={normalizedFrom}
          to={normalizedTo}
          qualityTier={qualityTier}
          q={q}
          sourceId={sourceId}
          sourceChannel={sourceChannel}
          primaryType={primaryType}
          limit={limit}
          offset={offset}
          result={result}
          sources={sources}
          typeStats={typeStats}
          submitQualityFeedback={submitQualityFeedback}
          fetchArticleContent={fetchArticleContent}
        />
      )}
    </main>
  );
}
