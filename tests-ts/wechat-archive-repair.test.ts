import { describe, expect, it } from "vitest";
import {
  planWechatArchiveRepairs,
  type WechatArchiveRepairCandidate,
} from "@/lib/article-db/wechat-archive-repair";

function candidate(overrides: Partial<WechatArchiveRepairCandidate>): WechatArchiveRepairCandidate {
  return {
    date: "2026-04-09",
    articleId: "a1",
    sourceId: "wechat_khazix0918",
    title: "分享10个你可能不知道的Claude Code隐藏命令.",
    publishedAt: "2026-03-20T02:18:41.000Z",
    canonicalUrl: "https://mp.weixin.qq.com/s?new=1&signature=abc&src=11&timestamp=1&ver=1",
    originalUrl: "https://mp.weixin.qq.com/s?new=1&signature=abc&src=11&timestamp=1&ver=1",
    infoUrl: "https://mp.weixin.qq.com/s?new=1&signature=abc&src=11&timestamp=1&ver=1",
    summaryRaw: "summary",
    leadParagraph: "lead",
    contentText: "content",
    contentFullText: "",
    contentFullHtml: "",
    analyzedAt: "2026-04-09T01:00:00.000Z",
    analyzedRankScore: 100,
    analyzedQualityScore: 88,
    selectedAt: "",
    selectedRankScore: 0,
    selectedQualityScore: 0,
    updatedAt: "2026-04-09T01:00:00.000Z",
    ...overrides,
  };
}

describe("planWechatArchiveRepairs", () => {
  it("collapses duplicate daily rows onto one survivor article id", () => {
    const plan = planWechatArchiveRepairs(
      [
        candidate({
          articleId: "survivor",
          canonicalUrl: "https://mp.weixin.qq.com/s?new=1&signature=abc&src=11&timestamp=1&ver=1",
          selectedAt: "2026-04-09T01:10:00.000Z",
          selectedRankScore: 200,
          selectedQualityScore: 92,
          contentFullHtml: "<p>rich</p>",
        }),
        candidate({
          articleId: "duplicate",
          canonicalUrl: "https://mp.weixin.qq.com/s?new=1&signature=xyz&src=11&timestamp=2&ver=2",
        }),
      ],
      { maxAgeDays: 30, timezoneName: "Asia/Shanghai" },
    );

    expect(plan.duplicateGroupCount).toBe(1);
    expect(plan.duplicateRowCount).toBe(1);
    expect(plan.survivorArticleIds).toEqual(["survivor"]);
    expect(plan.analyzedDeletes).toEqual([{ date: "2026-04-09", articleId: "duplicate" }]);
  });

  it("removes stale rows outside the report window", () => {
    const plan = planWechatArchiveRepairs(
      [
        candidate({
          articleId: "stale",
          sourceId: "wechat_kongmou",
          title: "展望2026年的Agent应用层演进",
          publishedAt: "2026-03-17T08:47:26.000Z",
          selectedAt: "2026-04-09T01:10:00.000Z",
          selectedRankScore: 100,
          selectedQualityScore: 80,
        }),
      ],
      { maxAgeDays: 3, timezoneName: "Asia/Shanghai" },
    );

    expect(plan.staleRowCount).toBe(1);
    expect(plan.analyzedDeletes).toEqual([{ date: "2026-04-09", articleId: "stale" }]);
    expect(plan.highQualityDeletes).toEqual([{ date: "2026-04-09", articleId: "stale" }]);
  });
});
