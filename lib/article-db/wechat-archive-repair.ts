import {
  buildArticleIdentityKey,
  isPublishedWithinReportWindow,
} from "@/lib/domain/article-identity";

export interface WechatArchiveRepairCandidate {
  date: string;
  articleId: string;
  sourceId: string;
  title: string;
  publishedAt: string;
  canonicalUrl: string;
  originalUrl: string;
  infoUrl: string;
  summaryRaw: string;
  leadParagraph: string;
  contentText: string;
  contentFullText: string;
  contentFullHtml: string;
  analyzedAt: string;
  analyzedRankScore: number;
  analyzedQualityScore: number;
  selectedAt: string;
  selectedRankScore: number;
  selectedQualityScore: number;
  updatedAt: string;
}

interface DailyUpsertRow {
  date: string;
  articleId: string;
  qualityScoreSnapshot: number;
  rankScore: number;
}

export interface WechatArchiveRepairPlan {
  analyzedDeletes: Array<{ date: string; articleId: string }>;
  highQualityDeletes: Array<{ date: string; articleId: string }>;
  analyzedUpserts: DailyUpsertRow[];
  highQualityUpserts: DailyUpsertRow[];
  survivorArticleIds: string[];
  candidateCount: number;
  staleRowCount: number;
  duplicateGroupCount: number;
  duplicateRowCount: number;
}

function parseIsoMs(value: string): number {
  const parsed = new Date(String(value || ""));
  const ms = parsed.getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function candidateScore(candidate: WechatArchiveRepairCandidate): number {
  const selectedBoost = candidate.selectedAt ? 1_000_000_000_000 : 0;
  const contentScore =
    candidate.contentFullHtml.length * 20 +
    candidate.contentFullText.length * 10 +
    candidate.contentText.length * 5 +
    candidate.summaryRaw.length * 2 +
    candidate.leadParagraph.length;
  const qualityScore = Math.round(candidate.selectedRankScore || candidate.analyzedRankScore || 0);
  return selectedBoost + qualityScore + contentScore + parseIsoMs(candidate.updatedAt) / 1_000_000;
}

function addDelete(
  target: Map<string, { date: string; articleId: string }>,
  date: string,
  articleId: string,
): void {
  target.set(`${date}::${articleId}`, { date, articleId });
}

function mergeDailyUpsert(target: Map<string, DailyUpsertRow>, row: DailyUpsertRow): void {
  const key = `${row.date}::${row.articleId}`;
  const existing = target.get(key);
  if (!existing) {
    target.set(key, row);
    return;
  }
  target.set(key, {
    date: row.date,
    articleId: row.articleId,
    qualityScoreSnapshot: Math.max(existing.qualityScoreSnapshot, row.qualityScoreSnapshot),
    rankScore: Math.max(existing.rankScore, row.rankScore),
  });
}

export function planWechatArchiveRepairs(
  candidates: WechatArchiveRepairCandidate[],
  params: {
    maxAgeDays: number;
    timezoneName: string;
  },
): WechatArchiveRepairPlan {
  const analyzedDeletes = new Map<string, { date: string; articleId: string }>();
  const highQualityDeletes = new Map<string, { date: string; articleId: string }>();
  const analyzedUpserts = new Map<string, DailyUpsertRow>();
  const highQualityUpserts = new Map<string, DailyUpsertRow>();
  const survivorArticleIds = new Set<string>();
  const byIdentity = new Map<string, WechatArchiveRepairCandidate[]>();
  let staleRowCount = 0;
  let duplicateGroupCount = 0;
  let duplicateRowCount = 0;

  for (const candidate of candidates) {
    const identityKey = buildArticleIdentityKey({
      sourceId: candidate.sourceId,
      sourceType: "wechat",
      url: candidate.canonicalUrl || candidate.infoUrl || candidate.originalUrl,
      infoUrl: candidate.infoUrl || candidate.originalUrl || candidate.canonicalUrl,
      title: candidate.title,
      publishedAt: candidate.publishedAt ? new Date(candidate.publishedAt) : null,
      summaryRaw: candidate.summaryRaw,
    });
    const bucket = byIdentity.get(identityKey) || [];
    bucket.push(candidate);
    byIdentity.set(identityKey, bucket);
  }

  for (const group of byIdentity.values()) {
    const sortedCandidates = [...group].sort(
      (left, right) => candidateScore(right) - candidateScore(left),
    );
    const survivor = sortedCandidates[0];
    survivorArticleIds.add(survivor.articleId);

    if (new Set(group.map((candidate) => candidate.articleId)).size > 1) {
      duplicateGroupCount += 1;
    }

    for (const candidate of group) {
      const isStale = !isPublishedWithinReportWindow(
        candidate.publishedAt ? new Date(candidate.publishedAt) : null,
        candidate.date,
        params.maxAgeDays,
        params.timezoneName,
      );

      if (isStale) {
        staleRowCount += 1;
        addDelete(analyzedDeletes, candidate.date, candidate.articleId);
        if (candidate.selectedAt) {
          addDelete(highQualityDeletes, candidate.date, candidate.articleId);
        }
        continue;
      }

      if (candidate.articleId === survivor.articleId) {
        continue;
      }

      duplicateRowCount += 1;
      addDelete(analyzedDeletes, candidate.date, candidate.articleId);
      mergeDailyUpsert(analyzedUpserts, {
        date: candidate.date,
        articleId: survivor.articleId,
        qualityScoreSnapshot: candidate.analyzedQualityScore,
        rankScore: candidate.analyzedRankScore,
      });

      if (candidate.selectedAt) {
        addDelete(highQualityDeletes, candidate.date, candidate.articleId);
        mergeDailyUpsert(highQualityUpserts, {
          date: candidate.date,
          articleId: survivor.articleId,
          qualityScoreSnapshot: candidate.selectedQualityScore || candidate.analyzedQualityScore,
          rankScore: candidate.selectedRankScore || candidate.analyzedRankScore,
        });
      }
    }
  }

  return {
    analyzedDeletes: Array.from(analyzedDeletes.values()),
    highQualityDeletes: Array.from(highQualityDeletes.values()),
    analyzedUpserts: Array.from(analyzedUpserts.values()),
    highQualityUpserts: Array.from(highQualityUpserts.values()),
    survivorArticleIds: Array.from(survivorArticleIds.values()),
    candidateCount: candidates.length,
    staleRowCount,
    duplicateGroupCount,
    duplicateRowCount,
  };
}
