import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as postSent } from "@/app/api/v1/flomo/push-batches/[batch_key]/sent/route";
import { POST as postFailed } from "@/app/api/v1/flomo/push-batches/[batch_key]/failed/route";

const {
  markFlomoArchivePushBatchSentMock,
  markFlomoArchivePushBatchFailedMock,
} = vi.hoisted(() => {
  return {
    markFlomoArchivePushBatchSentMock: vi.fn(),
    markFlomoArchivePushBatchFailedMock: vi.fn(),
  };
});

vi.mock("@/lib/article-db/repository", () => {
  return {
    markFlomoArchivePushBatchSent: (...args: unknown[]) => markFlomoArchivePushBatchSentMock(...args),
    markFlomoArchivePushBatchFailed: (...args: unknown[]) => markFlomoArchivePushBatchFailedMock(...args),
  };
});

describe("article-db flomo push batch state routes", () => {
  beforeEach(() => {
    markFlomoArchivePushBatchSentMock.mockResolvedValue(2);
    markFlomoArchivePushBatchFailedMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.ARTICLE_DB_API_TOKEN;
  });

  it("returns 401 for sent route when article-db token does not match", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "expected";
    const response = await postSent(
      new Request("https://example.com/api/v1/flomo/push-batches/batch_1/sent", { method: "POST" }),
      {
        params: Promise.resolve({ batch_key: "batch_1" }),
      },
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(401);
    expect(payload.ok).toBe(false);
  });

  it("marks batch as sent and returns consumed_count", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "expected";
    const response = await postSent(
      new Request("https://example.com/api/v1/flomo/push-batches/batch_1/sent", {
        method: "POST",
        headers: {
          Authorization: "Bearer expected",
        },
      }),
      {
        params: Promise.resolve({ batch_key: "batch_1" }),
      },
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.batch_key).toBe("batch_1");
    expect(payload.consumed_count).toBe(2);
    expect(markFlomoArchivePushBatchSentMock).toHaveBeenCalledWith("batch_1");
  });

  it("marks batch as failed with provided error message", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "expected";
    const response = await postFailed(
      new Request("https://example.com/api/v1/flomo/push-batches/batch_2/failed", {
        method: "POST",
        headers: {
          Authorization: "Bearer expected",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          error_message: "delivery timeout",
        }),
      }),
      {
        params: Promise.resolve({ batch_key: "batch_2" }),
      },
    );
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.batch_key).toBe("batch_2");
    expect(markFlomoArchivePushBatchFailedMock).toHaveBeenCalledWith({
      batchKey: "batch_2",
      errorMessage: "delivery timeout",
    });
  });
});
