import { describe, expect, it } from "vitest";
import { Article } from "@/lib/domain/models";
import { buildEvaluationPool } from "@/lib/article-db/ingestion-runner";

function article(params: {
  id: string;
  sourceType: string;
  publishedAt: string;
}): Article {
  return {
    id: params.id,
    title: params.id,
    url: `https://example.com/${params.id}`,
    sourceId: params.id,
    sourceName: params.id,
    sourceType: params.sourceType,
    publishedAt: new Date(params.publishedAt),
    summaryRaw: "",
    leadParagraph: "",
    contentText: "",
    infoUrl: `https://example.com/${params.id}`,
    tags: [],
    primaryType: "",
    secondaryTypes: [],
  };
}

describe("buildEvaluationPool", () => {
  it("reserves recent wechat items before filling the remaining slots", () => {
    const now = Date.parse("2026-04-07T12:00:00.000Z");
    const ranked = [
      article({ id: "rss-1", sourceType: "rss", publishedAt: "2026-04-07T11:00:00.000Z" }),
      article({ id: "rss-2", sourceType: "rss", publishedAt: "2026-04-07T10:00:00.000Z" }),
      article({ id: "rss-3", sourceType: "rss", publishedAt: "2026-04-07T09:00:00.000Z" }),
      article({ id: "wechat-1", sourceType: "wechat", publishedAt: "2026-03-20T09:00:00.000Z" }),
      article({ id: "wechat-2", sourceType: "wechat", publishedAt: "2026-03-18T09:00:00.000Z" }),
    ];

    const result = buildEvaluationPool(ranked, 3, {
      reservedWechatArticles: 1,
      reservedWechatMaxAgeDays: 30,
      nowMs: now,
    });

    expect(result.map((item) => item.id)).toEqual(["wechat-1", "rss-1", "rss-2"]);
  });

  it("does not reserve stale wechat items beyond the freshness window", () => {
    const now = Date.parse("2026-04-07T12:00:00.000Z");
    const ranked = [
      article({ id: "rss-1", sourceType: "rss", publishedAt: "2026-04-07T11:00:00.000Z" }),
      article({ id: "rss-2", sourceType: "rss", publishedAt: "2026-04-07T10:00:00.000Z" }),
      article({ id: "wechat-old", sourceType: "wechat", publishedAt: "2026-02-01T09:00:00.000Z" }),
    ];

    const result = buildEvaluationPool(ranked, 2, {
      reservedWechatArticles: 1,
      reservedWechatMaxAgeDays: 30,
      nowMs: now,
    });

    expect(result.map((item) => item.id)).toEqual(["rss-1", "rss-2"]);
  });
});
