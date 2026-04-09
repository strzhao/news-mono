import { describe, expect, it } from "vitest";
import { dedupeArticles, normalizeUrl } from "@/lib/process/dedupe";

describe("dedupe", () => {
  it("normalizeUrl removes tracking params", () => {
    const normalized = normalizeUrl("https://example.com/a?utm_source=x&id=1");
    expect(normalized).toContain("id=1");
    expect(normalized).not.toContain("utm_source");
  });

  it("dedupeArticles drops url duplicates", () => {
    const baseArticle = {
      id: "1",
      title: "Title A",
      url: "https://example.com/a?id=1",
      infoUrl: "",
      sourceId: "s1",
      sourceName: "Source",
      sourceType: "rss",
      publishedAt: null,
      summaryRaw: "",
      leadParagraph: "",
      contentText: "",
      tags: [],
      primaryType: "",
      secondaryTypes: [],
    };

    const [deduped, stats] = dedupeArticles(
      [baseArticle, { ...baseArticle, id: "2", url: "https://example.com/a?id=1&utm_campaign=t" }],
      0.93,
      true,
    ) as any;

    expect(deduped).toHaveLength(1);
    expect(stats.urlDuplicates).toBe(1);
  });

  it("dedupeArticles collapses wechat signed urls into one article", () => {
    const baseArticle = {
      id: "1",
      title: "分享10个你可能不知道的Claude Code隐藏命令.",
      url: "https://mp.weixin.qq.com/s?new=1&signature=abc&src=11&timestamp=1&ver=1",
      infoUrl: "https://mp.weixin.qq.com/s?new=1&signature=abc&src=11&timestamp=1&ver=1",
      sourceId: "wechat_khazix0918",
      sourceName: "Source",
      sourceType: "wechat",
      publishedAt: new Date("2026-03-20T02:18:41.000Z"),
      summaryRaw: "",
      leadParagraph: "",
      contentText: "",
      tags: [],
      primaryType: "",
      secondaryTypes: [],
    };

    const [deduped, stats] = dedupeArticles(
      [
        baseArticle,
        {
          ...baseArticle,
          id: "2",
          url: "https://mp.weixin.qq.com/s?new=1&signature=xyz&src=11&timestamp=2&ver=2",
          infoUrl: "https://mp.weixin.qq.com/s?new=1&signature=xyz&src=11&timestamp=2&ver=2",
        },
      ],
      0.93,
      true,
    ) as any;

    expect(deduped).toHaveLength(1);
    expect(stats.urlDuplicates).toBe(1);
  });
});
