import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "@/app/api/v1/maintenance/wechat-repair/route";
import { repairWechatDailyArchives } from "@/lib/article-db/repository";

vi.mock("@/lib/article-db/repository", () => {
  return {
    repairWechatDailyArchives: vi.fn(),
  };
});

describe("wechat repair route", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    delete process.env.ARTICLE_DB_API_TOKEN;
  });

  it("returns 401 when missing authorization", async () => {
    process.env.CRON_SECRET = "secret";
    const response = await GET(
      new Request(
        "https://example.com/api/v1/maintenance/wechat-repair?from=2026-04-07&to=2026-04-09",
      ),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(payload.ok).toBe(false);
  });

  it("runs repair when authorized", async () => {
    process.env.CRON_SECRET = "secret";
    vi.mocked(repairWechatDailyArchives).mockResolvedValue({
      fromDate: "2026-04-07",
      toDate: "2026-04-09",
      timezoneName: "Asia/Shanghai",
      maxAgeDays: 3,
      candidateCount: 10,
      staleRowCount: 6,
      duplicateGroupCount: 2,
      duplicateRowCount: 4,
      analyzedDeleted: 10,
      highQualityDeleted: 8,
      analyzedUpserted: 2,
      highQualityUpserted: 1,
      survivorArticleCount: 3,
    });

    const response = await GET(
      new Request(
        "https://example.com/api/v1/maintenance/wechat-repair?from=2026-04-07&to=2026-04-09&max_age_days=3",
        {
          headers: {
            Authorization: "Bearer secret",
          },
        },
      ),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(repairWechatDailyArchives).toHaveBeenCalledWith({
      fromDate: "2026-04-07",
      toDate: "2026-04-09",
      timezoneName: "Asia/Shanghai",
      maxAgeDays: 3,
    });
  });
});
