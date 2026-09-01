import {
  buildArticleIdentityKey,
  normalizeArticleTitleKey,
  normalizeArticleUrl,
} from "@/lib/domain/article-identity";
import type { Article, DedupeStats } from "@/lib/domain/models";

export const normalizeUrl = normalizeArticleUrl;

function normalizedTitle(title: string): string {
  return normalizeArticleTitleKey(title);
}

function levenshteinRatio(a: string, b: string): number {
  const left = normalizedTitle(a);
  const right = normalizedTitle(b);
  if (left === right) return 1;
  if (!left || !right) return 0;

  const m = left.length;
  const n = right.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, j) => j);

  for (let i = 1; i <= m; i += 1) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= n; j += 1) {
      const temp = dp[j];
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + cost);
      prev = temp;
    }
  }

  const distance = dp[n];
  const maxLen = Math.max(m, n);
  return maxLen > 0 ? 1 - distance / maxLen : 0;
}

export function dedupeArticles(
  articles: Article[],
  titleSimilarityThreshold = 0.93,
  returnStats = false,
): Article[] | [Article[], DedupeStats] {
  const deduped: Article[] = [];
  const seenIdentityKeys = new Set<string>();
  const identityToArticle = new Map<string, Article>();

  let urlDuplicates = 0;
  let titleDuplicates = 0;
  const droppedItems: Array<Record<string, string>> = [];

  for (const article of articles) {
    const identityKey = buildArticleIdentityKey(article);
    if (seenIdentityKeys.has(identityKey)) {
      urlDuplicates += 1;
      const matched = identityToArticle.get(identityKey);
      droppedItems.push({
        reason: "url_duplicate",
        article_id: article.id,
        title: article.title,
        source_id: article.sourceId,
        url: article.url,
        matched_article_id: matched?.id || "",
        matched_title: matched?.title || "",
        matched_url: matched?.url || "",
        similarity: article.url === matched?.url ? "1.0" : "stable_key",
      });
      continue;
    }

    let duplicate = false;
    let duplicateMatch: Article | null = null;
    let duplicateSimilarity = 0;
    for (const existing of deduped) {
      const similarity = levenshteinRatio(article.title, existing.title);
      if (similarity >= titleSimilarityThreshold) {
        duplicate = true;
        duplicateMatch = existing;
        duplicateSimilarity = similarity;
        break;
      }
    }

    if (duplicate) {
      titleDuplicates += 1;
      droppedItems.push({
        reason: "title_similar",
        article_id: article.id,
        title: article.title,
        source_id: article.sourceId,
        url: article.url,
        matched_article_id: duplicateMatch?.id || "",
        matched_title: duplicateMatch?.title || "",
        matched_url: duplicateMatch?.url || "",
        similarity: duplicateSimilarity.toFixed(4),
      });
      continue;
    }

    seenIdentityKeys.add(identityKey);
    identityToArticle.set(identityKey, article);
    deduped.push(article);
  }

  if (!returnStats) {
    return deduped;
  }

  return [
    deduped,
    {
      totalInput: articles.length,
      kept: deduped.length,
      urlDuplicates,
      titleDuplicates,
      droppedItems,
    },
  ];
}
