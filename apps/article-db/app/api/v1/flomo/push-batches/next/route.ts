import crypto from "node:crypto";
import { requireArticleDbAuth } from "@/lib/article-db/auth";
import {
  createFlomoArchivePushBatch,
  getNextRetryableFlomoArchivePushBatch,
  listActiveTagDefinitions,
  listConsumedFlomoArchiveArticleIds,
  listHighQualityRange,
} from "@/lib/article-db/repository";
import type { HighQualityArticleGroup, HighQualityArticleItem } from "@/lib/article-db/types";
import { jsonResponse } from "@/lib/infra/route-utils";
import {
  buildFlomoArchiveArticlesPayload,
  type FlomoArchiveArticleSummary,
} from "@/lib/output/flomo-archive-articles-formatter";

export const runtime = "nodejs";
export const maxDuration = 120;
export const preferredRegion = ["sin1"];

type QualityTier = "high" | "general" | "all";

interface NextBatchBody {
  date?: string;
  tz?: string;
  days?: number;
  limit_per_day?: number;
  article_limit_per_day?: number;
  quality_tier?: string;
}

interface ArchiveFetchOptions {
  days: number;
  limitPerDay: number;
  articleLimitPerDay: number;
  qualityTier: QualityTier;
  timezoneName: string;
}

function boundedInt(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(min, Math.min(parsed, max));
}

function boundedIntAllowZero(value: unknown, fallback: number, max: number): number {
  const parsed = Number.parseInt(String(value ?? fallback), 10);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  if (parsed <= 0) {
    return 0;
  }
  return Math.max(1, Math.min(parsed, max));
}

function normalizeQualityTier(raw: unknown): QualityTier {
  const value = String(raw || "").trim().toLowerCase();
  if (["general", "normal", "common", "non_high"].includes(value)) return "general";
  if (["all", "any"].includes(value)) return "all";
  return "high";
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

function normalizedDate(raw: unknown, fallback: string): string {
  const value = String(raw || "").trim() || fallback;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`Invalid date: ${value}`);
  }
  return value;
}

async function parseBody(request: Request): Promise<NextBatchBody> {
  try {
    const raw = (await request.json()) as NextBatchBody;
    if (!raw || typeof raw !== "object") {
      return {};
    }
    return raw;
  } catch {
    return {};
  }
}

function buildBatchKey(sourceDate: string): string {
  const nonce = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const hash = crypto.createHash("sha256").update(`${sourceDate}:${nonce}`).digest("hex").slice(0, 12);
  return `archive-articles-${sourceDate}-${hash}`;
}

function sortGroupsByDateDesc<T extends { date: string }>(groups: T[]): T[] {
  return [...groups].sort((left, right) => String(right.date || "").localeCompare(String(left.date || "")));
}

function flattenArticleIds(groups: Array<{ items: FlomoArchiveArticleSummary[] }>): string[] {
  const ids: string[] = [];
  groups.forEach((group) => {
    group.items.forEach((item) => {
      const articleId = String(item.article_id || "").trim();
      if (articleId) {
        ids.push(articleId);
      }
    });
  });
  return ids;
}

function filterUnconsumedArticles(
  articles: FlomoArchiveArticleSummary[],
  consumedIds: Set<string>,
): FlomoArchiveArticleSummary[] {
  return articles.filter((item) => {
    const articleId = String(item.article_id || "").trim();
    return articleId && !consumedIds.has(articleId);
  });
}

function countTagsInContent(content: string): number {
  return String(content || "")
    .split(/\r?\n/)
    .filter((line) => line.includes("#"))
    .join(" ")
    .split(/\s+/)
    .filter((token) => /^#[^\s]+$/.test(token)).length;
}

function normalizeFlomoArchiveArticle(item: HighQualityArticleItem): FlomoArchiveArticleSummary {
  return {
    article_id: String(item.article_id || ""),
    title: String(item.title || ""),
    url: String(item.url || ""),
    summary: String(item.summary || ""),
    image_url: String(item.image_url || ""),
    source_host: String(item.source_host || ""),
    tag_groups: item.tag_groups && typeof item.tag_groups === "object" ? item.tag_groups : {},
    date: String(item.date || ""),
    digest_id: String(item.digest_id || ""),
    generated_at: String(item.generated_at || ""),
  };
}

function toFlomoArchiveGroups(groups: HighQualityArticleGroup[], articleLimitPerDay: number): Array<{
  date: string;
  items: FlomoArchiveArticleSummary[];
}> {
  return groups
    .map((group) => ({
      date: String(group.date || ""),
      items: (group.items || []).map(normalizeFlomoArchiveArticle),
    }))
    .map((group) => ({
      ...group,
      items: articleLimitPerDay > 0 ? group.items.slice(0, articleLimitPerDay) : group.items,
    }))
    .filter((group) => group.date && group.items.length > 0);
}

async function listArchiveGroups(options: ArchiveFetchOptions): Promise<Array<{ date: string; items: FlomoArchiveArticleSummary[] }>> {
  const toDate = dateShift(0, options.timezoneName);
  const fromDate = dateShift(Math.max(0, options.days - 1), options.timezoneName);
  const result = await listHighQualityRange({
    fromDate: fromDate <= toDate ? fromDate : toDate,
    toDate: fromDate <= toDate ? toDate : fromDate,
    limitPerDay: options.articleLimitPerDay > 0 ? Math.min(options.limitPerDay, options.articleLimitPerDay) : options.limitPerDay,
    qualityTier: options.qualityTier,
  });
  const normalized = toFlomoArchiveGroups(result.groups, options.articleLimitPerDay);
  return sortGroupsByDateDesc(normalized).slice(0, options.days);
}

async function buildRetryPayloadFromArchives(params: {
  batchKey: string;
  sourceDate: string;
  articleIds: string[];
  activeTagDefinitions: Awaited<ReturnType<typeof listActiveTagDefinitions>>;
  archiveOptions: ArchiveFetchOptions;
}): Promise<{ content: string; articleCount: number }> {
  const groups = await listArchiveGroups(params.archiveOptions);
  const byArticleId = new Map<string, FlomoArchiveArticleSummary>();
  groups.forEach((group) => {
    group.items.forEach((item) => {
      const articleId = String(item.article_id || "").trim();
      if (!articleId || byArticleId.has(articleId)) {
        return;
      }
      byArticleId.set(articleId, item);
    });
  });

  const selectedArticles: FlomoArchiveArticleSummary[] = [];
  params.articleIds.forEach((articleId) => {
    const article = byArticleId.get(articleId);
    if (article) {
      selectedArticles.push(article);
    }
  });

  if (!selectedArticles.length) {
    return {
      content: "",
      articleCount: 0,
    };
  }

  const payload = buildFlomoArchiveArticlesPayload({
    reportDate: params.sourceDate,
    articles: selectedArticles,
    dedupeKey: params.batchKey,
    activeTagDefinitions: params.activeTagDefinitions,
    tagLimit: 20,
  });
  return {
    content: payload.content,
    articleCount: selectedArticles.length,
  };
}

export async function POST(request: Request): Promise<Response> {
  const unauthorized = await requireArticleDbAuth(request);
  if (unauthorized) {
    return jsonResponse(unauthorized.status, { ok: false, error: unauthorized.error, auth_mode: unauthorized.mode }, true);
  }

  try {
    const body = await parseBody(request);
    const timezoneName = String(body.tz || process.env.DIGEST_TIMEZONE || "Asia/Shanghai").trim() || "Asia/Shanghai";
    const hasExplicitDate = Boolean(String(body.date || "").trim());
    const reportDate = normalizedDate(body.date, dateShift(0, timezoneName));
    const days = boundedInt(body.days, Number.parseInt(process.env.FLOMO_ARCHIVE_DAYS || "30", 10) || 30, 1, 30);
    const limitPerDay = boundedInt(
      body.limit_per_day,
      Number.parseInt(process.env.FLOMO_ARCHIVE_LIMIT_PER_DAY || "30", 10) || 30,
      1,
      200,
    );
    const articleLimitPerDay = boundedIntAllowZero(
      body.article_limit_per_day,
      Number.parseInt(process.env.FLOMO_ARCHIVE_ARTICLE_LIMIT_PER_DAY || "30", 10) || 30,
      5000,
    );
    const qualityTier = normalizeQualityTier(body.quality_tier);
    const archiveOptions: ArchiveFetchOptions = {
      days,
      limitPerDay,
      articleLimitPerDay,
      qualityTier,
      timezoneName,
    };

    const retryBatch = await getNextRetryableFlomoArchivePushBatch();
    const activeTagDefinitions = await listActiveTagDefinitions();
    if (retryBatch) {
      const batchKey = String(retryBatch.batchKey || "").trim();
      if (!batchKey) {
        throw new Error("Invalid retry batch: missing batch key");
      }

      let content = String(retryBatch.payloadContent || "");
      let articleCount = retryBatch.articleIds.length;
      if (!content.trim()) {
        const rebuilt = await buildRetryPayloadFromArchives({
          batchKey,
          sourceDate: retryBatch.sourceDate || reportDate,
          articleIds: retryBatch.articleIds,
          activeTagDefinitions,
          archiveOptions,
        });
        content = rebuilt.content;
        articleCount = rebuilt.articleCount;
      }

      if (!content.trim()) {
        return jsonResponse(
          200,
          {
            ok: true,
            generated_at: new Date().toISOString(),
            report_date: reportDate,
            source_date: retryBatch.sourceDate || reportDate,
            timezone: timezoneName,
            quality_tier: qualityTier,
            has_batch: false,
            retrying_batch: true,
            batch_key: batchKey,
            article_count: 0,
            tag_count: 0,
            content: "",
            reason: "Retry batch payload is empty",
          },
          true,
        );
      }

      return jsonResponse(
        200,
        {
          ok: true,
          generated_at: new Date().toISOString(),
          report_date: reportDate,
          source_date: retryBatch.sourceDate || reportDate,
          timezone: timezoneName,
          quality_tier: qualityTier,
          has_batch: true,
          retrying_batch: true,
          batch_key: batchKey,
          article_count: articleCount,
          tag_count: countTagsInContent(content),
          content,
        },
        true,
      );
    }

    const groups = await listArchiveGroups(archiveOptions);
    const candidateGroups = hasExplicitDate ? groups.filter((group) => group.date === reportDate) : groups;
    const candidateArticleIds = flattenArticleIds(candidateGroups);
    const consumedIds = await listConsumedFlomoArchiveArticleIds(candidateArticleIds);

    const unconsumedGroups = candidateGroups
      .map((group) => ({
        ...group,
        items: filterUnconsumedArticles(Array.isArray(group.items) ? group.items : [], consumedIds),
      }))
      .filter((group) => group.items.length > 0);

    const targetGroup = unconsumedGroups[0] || { date: reportDate, items: [] };
    const sourceDate = targetGroup.date || reportDate;
    const articles = Array.isArray(targetGroup.items) ? targetGroup.items : [];

    if (!articles.length) {
      return jsonResponse(
        200,
        {
          ok: true,
          generated_at: new Date().toISOString(),
          report_date: reportDate,
          source_date: sourceDate,
          timezone: timezoneName,
          quality_tier: qualityTier,
          has_batch: false,
          retrying_batch: false,
          article_count: 0,
          tag_count: 0,
          content: "",
          reason: "No unconsumed high-quality archive articles found",
        },
        true,
      );
    }

    const batchKey = buildBatchKey(sourceDate);
    const payload = buildFlomoArchiveArticlesPayload({
      reportDate: sourceDate,
      articles,
      dedupeKey: batchKey,
      activeTagDefinitions,
      tagLimit: 20,
    });

    await createFlomoArchivePushBatch({
      batchKey,
      sourceDate,
      articleIds: articles.map((item) => item.article_id),
      payloadContent: payload.content,
    });

    return jsonResponse(
      200,
      {
        ok: true,
        generated_at: new Date().toISOString(),
        report_date: reportDate,
        source_date: sourceDate,
        timezone: timezoneName,
        quality_tier: qualityTier,
        has_batch: true,
        retrying_batch: false,
        batch_key: batchKey,
        article_count: articles.length,
        tag_count: countTagsInContent(payload.content),
        content: payload.content,
      },
      true,
    );
  } catch (error) {
    return jsonResponse(
      500,
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      true,
    );
  }
}
