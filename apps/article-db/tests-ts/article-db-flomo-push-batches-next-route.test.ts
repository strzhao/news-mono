import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/v1/flomo/push-batches/next/route";

const {
  getNextRetryableFlomoArchivePushBatchMock,
  listActiveTagDefinitionsMock,
  listConsumedFlomoArchiveArticleIdsMock,
  listHighQualityRangeMock,
  createFlomoArchivePushBatchMock,
} = vi.hoisted(() => {
  return {
    getNextRetryableFlomoArchivePushBatchMock: vi.fn(),
    listActiveTagDefinitionsMock: vi.fn(),
    listConsumedFlomoArchiveArticleIdsMock: vi.fn(),
    listHighQualityRangeMock: vi.fn(),
    createFlomoArchivePushBatchMock: vi.fn(),
  };
});

vi.mock("@/lib/article-db/repository", () => {
  return {
    getNextRetryableFlomoArchivePushBatch: (...args: unknown[]) => getNextRetryableFlomoArchivePushBatchMock(...args),
    listActiveTagDefinitions: (...args: unknown[]) => listActiveTagDefinitionsMock(...args),
    listConsumedFlomoArchiveArticleIds: (...args: unknown[]) => listConsumedFlomoArchiveArticleIdsMock(...args),
    listHighQualityRange: (...args: unknown[]) => listHighQualityRangeMock(...args),
    createFlomoArchivePushBatch: (...args: unknown[]) => createFlomoArchivePushBatchMock(...args),
  };
});

describe("article-db flomo push batches next route", () => {
  beforeEach(() => {
    getNextRetryableFlomoArchivePushBatchMock.mockResolvedValue(null);
    listActiveTagDefinitionsMock.mockResolvedValue([]);
    listConsumedFlomoArchiveArticleIdsMock.mockResolvedValue(new Set<string>());
    listHighQualityRangeMock.mockResolvedValue({
      totalArticles: 0,
      groups: [],
    });
    createFlomoArchivePushBatchMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ARTICLE_DB_API_TOKEN;
  });

  it("returns 401 when article-db token does not match", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "expected";
    const response = await POST(new Request("https://example.com/api/v1/flomo/push-batches/next", { method: "POST" }));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(payload.ok).toBe(false);
  });

  it("returns retry batch directly when pending/failed batch exists", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "expected";
    getNextRetryableFlomoArchivePushBatchMock.mockResolvedValue({
      batchKey: "archive-articles-2026-03-01-retry",
      sourceDate: "2026-03-01",
      status: "failed",
      articleIds: ["a1"],
      payloadContent: "retry payload #tag1",
      createdAt: "2026-03-01T00:00:00.000Z",
      sentAt: "",
      lastError: "timeout",
    });

    const response = await POST(
      new Request("https://example.com/api/v1/flomo/push-batches/next", {
        method: "POST",
        headers: {
          Authorization: "Bearer expected",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ date: "2026-03-01", tz: "Asia/Shanghai" }),
      }),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.has_batch).toBe(true);
    expect(payload.retrying_batch).toBe(true);
    expect(payload.batch_key).toBe("archive-articles-2026-03-01-retry");
    expect(payload.content).toBe("retry payload #tag1");
    expect(createFlomoArchivePushBatchMock).not.toHaveBeenCalled();
  });

  it("returns has_batch=false when no unconsumed article is available", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "expected";
    listHighQualityRangeMock.mockResolvedValue({
      totalArticles: 0,
      groups: [],
    });

    const response = await POST(
      new Request("https://example.com/api/v1/flomo/push-batches/next", {
        method: "POST",
        headers: {
          Authorization: "Bearer expected",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ date: "2026-03-01", tz: "Asia/Shanghai" }),
      }),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.has_batch).toBe(false);
    expect(payload.reason).toBe("No unconsumed high-quality archive articles found");
    expect(createFlomoArchivePushBatchMock).not.toHaveBeenCalled();
  });

  it("creates new batch from latest unconsumed source date", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "expected";
    listHighQualityRangeMock.mockResolvedValue({
      totalArticles: 2,
      groups: [
        {
          date: "2026-03-02",
          items: [
            {
              article_id: "a2",
              title: "Second title",
              url: "https://example.com/a2",
              summary: "第二篇摘要",
              image_url: "",
              source_host: "example.com",
              source_id: "s2",
              source_name: "S2",
              date: "2026-03-02",
              digest_id: "d2",
              generated_at: "2026-03-02T00:00:00.000Z",
              quality_score: 80,
              quality_tier: "high",
              confidence: 0.9,
              primary_type: "tooling",
              secondary_types: [],
              tag_groups: {
                topic: ["llm"],
              },
            },
          ],
        },
        {
          date: "2026-03-01",
          items: [
            {
              article_id: "a1",
              title: "First title",
              url: "https://example.com/a1",
              summary: "第一篇摘要",
              image_url: "",
              source_host: "example.com",
              source_id: "s1",
              source_name: "S1",
              date: "2026-03-01",
              digest_id: "d1",
              generated_at: "2026-03-01T00:00:00.000Z",
              quality_score: 78,
              quality_tier: "high",
              confidence: 0.88,
              primary_type: "agent",
              secondary_types: [],
              tag_groups: {
                topic: ["multi_agent"],
              },
            },
          ],
        },
      ],
    });
    listConsumedFlomoArchiveArticleIdsMock.mockResolvedValue(new Set(["a2"]));

    const response = await POST(
      new Request("https://example.com/api/v1/flomo/push-batches/next", {
        method: "POST",
        headers: {
          Authorization: "Bearer expected",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tz: "Asia/Shanghai" }),
      }),
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.has_batch).toBe(true);
    expect(payload.retrying_batch).toBe(false);
    expect(payload.source_date).toBe("2026-03-01");
    expect(payload.article_count).toBe(1);
    expect(String(payload.batch_key || "")).toMatch(/^archive-articles-2026-03-01-/);
    expect(createFlomoArchivePushBatchMock).toHaveBeenCalledTimes(1);
    expect(createFlomoArchivePushBatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceDate: "2026-03-01",
        articleIds: ["a1"],
      }),
    );
  });
});
