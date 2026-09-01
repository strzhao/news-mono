import { describe, expect, it } from "vitest";
import {
  buildArticleIdentityKey,
  isPublishedWithinReportWindow,
  normalizeArticleTitleKey,
  normalizeArticleUrl,
} from "@/lib/domain/article-identity";

describe("article identity", () => {
  it("keeps generic URL normalization behavior", () => {
    const normalized = normalizeArticleUrl("https://Example.com/Path/?utm_source=x&fbclid=y&id=1");
    expect(normalized).toContain("example.com");
    expect(normalized).toContain("id=1");
    expect(normalized).not.toContain("utm_source");
    expect(normalized).not.toContain("fbclid");
  });

  it("builds the same wechat identity key for different signed mp urls", () => {
    const left = buildArticleIdentityKey({
      sourceId: "wechat_khazix0918",
      sourceType: "wechat",
      url: "https://mp.weixin.qq.com/s?new=1&signature=abc&src=11&timestamp=1&ver=1",
      title: "分享10个你可能不知道的Claude Code隐藏命令.",
      publishedAt: new Date("2026-03-20T02:18:41.000Z"),
    });
    const right = buildArticleIdentityKey({
      sourceId: "wechat_khazix0918",
      sourceType: "wechat",
      url: "https://mp.weixin.qq.com/s?new=1&signature=xyz&src=11&timestamp=2&ver=2",
      title: "分享10个你可能不知道的Claude Code隐藏命令.",
      publishedAt: new Date("2026-03-20T02:18:41.000Z"),
    });

    expect(left).toBe(right);
  });

  it("preserves Chinese characters in title normalization", () => {
    expect(normalizeArticleTitleKey("系统实现复杂度 与 用户理解心智复杂度")).toContain(
      "系统实现复杂度",
    );
  });

  it("checks freshness by report date window", () => {
    expect(
      isPublishedWithinReportWindow(
        new Date("2026-04-07T04:34:00.000Z"),
        "2026-04-09",
        3,
        "Asia/Shanghai",
      ),
    ).toBe(true);
    expect(
      isPublishedWithinReportWindow(
        new Date("2026-04-06T05:38:53.000Z"),
        "2026-04-09",
        3,
        "Asia/Shanghai",
      ),
    ).toBe(false);
  });
});
