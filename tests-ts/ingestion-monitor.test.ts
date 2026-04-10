import { afterEach, describe, expect, it, vi } from "vitest";
import { checkIngestionHealth, formatIngestionAlert } from "@/lib/article-db/ingestion-monitor";
import type { IngestionRunRow } from "@/lib/article-db/types";

function makeRun(overrides: Partial<IngestionRunRow> = {}): IngestionRunRow {
  return {
    id: "run_1",
    run_date: "2026-04-10",
    status: "success",
    started_at: new Date(Date.now() - 60 * 60_000).toISOString(),
    heartbeat_at: new Date(Date.now() - 55 * 60_000).toISOString(),
    finished_at: new Date(Date.now() - 55 * 60_000).toISOString(),
    fetched_count: 100,
    deduped_count: 80,
    analyzed_count: 30,
    selected_count: 10,
    error_message: "",
    stats_json: {},
    ...overrides,
  };
}

describe("checkIngestionHealth", () => {
  it("returns healthy when latest success is within threshold", () => {
    const runs = [
      makeRun({ status: "success", finished_at: new Date(Date.now() - 60 * 60_000).toISOString() }),
    ];
    const result = checkIngestionHealth(runs, 4);
    expect(result.healthy).toBe(true);
    expect(result.hoursSinceLastSuccess).toBeLessThan(4);
    expect(result.successCount).toBe(1);
  });

  it("returns unhealthy when latest success exceeds threshold", () => {
    const runs = [
      makeRun({
        status: "success",
        finished_at: new Date(Date.now() - 5 * 3_600_000).toISOString(),
      }),
    ];
    const result = checkIngestionHealth(runs, 4);
    expect(result.healthy).toBe(false);
    expect(result.hoursSinceLastSuccess).toBeGreaterThan(4);
  });

  it("returns unhealthy when no runs exist", () => {
    const result = checkIngestionHealth([], 4);
    expect(result.healthy).toBe(false);
    expect(result.hoursSinceLastSuccess).toBe(Number.POSITIVE_INFINITY);
    expect(result.hoursSinceLastRun).toBe(Number.POSITIVE_INFINITY);
    expect(result.totalRunsChecked).toBe(0);
  });

  it("returns unhealthy when only failed runs exist", () => {
    const runs = [makeRun({ status: "failed" }), makeRun({ id: "run_2", status: "failed" })];
    const result = checkIngestionHealth(runs, 4);
    expect(result.healthy).toBe(false);
    expect(result.failedCount).toBe(2);
    expect(result.successCount).toBe(0);
  });

  it("counts statuses correctly", () => {
    const runs = [
      makeRun({ id: "r1", status: "running" }),
      makeRun({
        id: "r2",
        status: "success",
        finished_at: new Date(Date.now() - 30 * 60_000).toISOString(),
      }),
      makeRun({ id: "r3", status: "failed" }),
      makeRun({
        id: "r4",
        status: "success",
        finished_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      }),
    ];
    const result = checkIngestionHealth(runs, 4);
    expect(result.healthy).toBe(true);
    expect(result.successCount).toBe(2);
    expect(result.failedCount).toBe(1);
    expect(result.runningCount).toBe(1);
    expect(result.totalRunsChecked).toBe(4);
  });

  it("uses most recent successful run for health determination", () => {
    const runs = [
      makeRun({
        id: "r1",
        status: "failed",
        started_at: new Date(Date.now() - 30 * 60_000).toISOString(),
      }),
      makeRun({
        id: "r2",
        status: "success",
        started_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
        finished_at: new Date(Date.now() - 2 * 3_600_000).toISOString(),
      }),
    ];
    const result = checkIngestionHealth(runs, 4);
    expect(result.healthy).toBe(true);
    expect(result.hoursSinceLastSuccess).toBeGreaterThanOrEqual(1.9);
    expect(result.hoursSinceLastSuccess).toBeLessThan(3);
  });
});

describe("formatIngestionAlert", () => {
  it("produces Flomo content with monitoring tag", () => {
    const result = checkIngestionHealth([], 4);
    const payload = formatIngestionAlert(result);
    expect(payload.content).toContain("#monitoring/ingestion_alert");
    expect(payload.content).toContain("未成功运行");
  });

  it("uses date-based dedupeKey", () => {
    const result = checkIngestionHealth([], 4);
    const payload = formatIngestionAlert(result);
    expect(payload.dedupeKey).toMatch(/^ingestion-alert-\d{4}-\d{2}-\d{2}$/);
  });

  it("includes last success info when available", () => {
    const runs = [
      makeRun({
        status: "success",
        finished_at: new Date(Date.now() - 5 * 3_600_000).toISOString(),
      }),
    ];
    const result = checkIngestionHealth(runs, 4);
    const payload = formatIngestionAlert(result);
    expect(payload.content).toContain("上次成功:");
    expect(payload.content).not.toContain("无记录");
  });

  it("handles no success records gracefully", () => {
    const result = checkIngestionHealth([], 4);
    const payload = formatIngestionAlert(result);
    expect(payload.content).toContain("无记录");
  });
});

// Route handler tests
vi.mock("@/lib/article-db/ingestion-runs", () => ({
  listRecentIngestionRuns: vi.fn(),
}));

vi.mock("@/lib/integrations/flomo-client", () => ({
  FlomoClient: vi.fn().mockImplementation(() => ({
    send: vi.fn().mockResolvedValue(undefined),
  })),
  FlomoSyncError: class extends Error {},
}));

import { GET } from "@/app/api/v1/ingestion/monitor/route";
import { listRecentIngestionRuns } from "@/lib/article-db/ingestion-runs";
import { FlomoClient } from "@/lib/integrations/flomo-client";

describe("GET /api/v1/ingestion/monitor", () => {
  afterEach(() => {
    vi.clearAllMocks();
    delete process.env.CRON_SECRET;
    delete process.env.FLOMO_API_URL;
    delete process.env.INGESTION_MONITOR_THRESHOLD_HOURS;
  });

  it("returns 401 when unauthorized", async () => {
    process.env.CRON_SECRET = "test-secret";
    const response = await GET(new Request("https://example.com/api/v1/ingestion/monitor"));
    expect(response.status).toBe(401);
  });

  it("returns 200 with healthy=true when recent success exists", async () => {
    process.env.CRON_SECRET = "test-secret";
    vi.mocked(listRecentIngestionRuns).mockResolvedValue([
      makeRun({ status: "success", finished_at: new Date(Date.now() - 60 * 60_000).toISOString() }),
    ]);

    const response = await GET(
      new Request("https://example.com/api/v1/ingestion/monitor?token=test-secret"),
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(body.healthy).toBe(true);
    expect(body.alert_sent).toBe(false);
  });

  it("returns 503 with healthy=false when no recent success", async () => {
    process.env.CRON_SECRET = "test-secret";
    vi.mocked(listRecentIngestionRuns).mockResolvedValue([
      makeRun({
        status: "failed",
        finished_at: new Date(Date.now() - 5 * 3_600_000).toISOString(),
      }),
    ]);

    const response = await GET(
      new Request("https://example.com/api/v1/ingestion/monitor?token=test-secret"),
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body.healthy).toBe(false);
  });

  it("sends Flomo alert when unhealthy and FLOMO_API_URL is set", async () => {
    process.env.CRON_SECRET = "test-secret";
    process.env.FLOMO_API_URL = "https://flomoapp.com/api/test";
    vi.mocked(listRecentIngestionRuns).mockResolvedValue([]);

    const response = await GET(
      new Request("https://example.com/api/v1/ingestion/monitor?token=test-secret"),
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body.alert_sent).toBe(true);
    expect(FlomoClient).toHaveBeenCalledWith("https://flomoapp.com/api/test");
  });

  it("does not send alert when alert=false", async () => {
    process.env.CRON_SECRET = "test-secret";
    process.env.FLOMO_API_URL = "https://flomoapp.com/api/test";
    vi.mocked(listRecentIngestionRuns).mockResolvedValue([]);

    const response = await GET(
      new Request("https://example.com/api/v1/ingestion/monitor?token=test-secret&alert=false"),
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body.alert_sent).toBe(false);
    expect(FlomoClient).not.toHaveBeenCalled();
  });

  it("does not send alert when FLOMO_API_URL is missing", async () => {
    process.env.CRON_SECRET = "test-secret";
    vi.mocked(listRecentIngestionRuns).mockResolvedValue([]);

    const response = await GET(
      new Request("https://example.com/api/v1/ingestion/monitor?token=test-secret"),
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body.alert_sent).toBe(false);
  });

  it("authorizes via x-vercel-cron header", async () => {
    process.env.CRON_SECRET = "test-secret";
    vi.mocked(listRecentIngestionRuns).mockResolvedValue([
      makeRun({ status: "success", finished_at: new Date().toISOString() }),
    ]);

    const request = new Request("https://example.com/api/v1/ingestion/monitor", {
      headers: { "x-vercel-cron": "1" },
    });
    const response = await GET(request);

    expect(response.status).toBe(200);
  });

  it("records alert_error when Flomo send fails", async () => {
    process.env.CRON_SECRET = "test-secret";
    process.env.FLOMO_API_URL = "https://flomoapp.com/api/test";
    vi.mocked(listRecentIngestionRuns).mockResolvedValue([]);
    vi.mocked(FlomoClient).mockImplementation(
      () =>
        ({
          send: vi.fn().mockRejectedValue(new Error("Flomo down")),
        }) as unknown as FlomoClient,
    );

    const response = await GET(
      new Request("https://example.com/api/v1/ingestion/monitor?token=test-secret"),
    );
    const body = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(503);
    expect(body.alert_sent).toBe(false);
    expect(body.alert_error).toBe("Flomo down");
  });
});
