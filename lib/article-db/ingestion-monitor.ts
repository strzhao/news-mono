import type { IngestionRunRow } from "@/lib/article-db/types";
import type { AiTodoNotePayload } from "@/lib/integrations/ai-todo-client";

export interface IngestionHealthResult {
  healthy: boolean;
  lastSuccessAt: string;
  lastRunAt: string;
  hoursSinceLastSuccess: number;
  hoursSinceLastRun: number;
  totalRunsChecked: number;
  successCount: number;
  failedCount: number;
  runningCount: number;
  thresholdHours: number;
  checkedAt: string;
}

export function checkIngestionHealth(
  runs: IngestionRunRow[],
  thresholdHours: number,
): IngestionHealthResult {
  const now = Date.now();
  const checkedAt = new Date(now).toISOString();

  let lastSuccessAt = "";
  let lastRunAt = "";
  let successCount = 0;
  let failedCount = 0;
  let runningCount = 0;

  for (const run of runs) {
    if (!lastRunAt && run.started_at) {
      lastRunAt = run.started_at;
    }
    if (run.status === "success") {
      successCount += 1;
      if (!lastSuccessAt && run.finished_at) {
        lastSuccessAt = run.finished_at;
      }
    } else if (run.status === "failed") {
      failedCount += 1;
    } else if (run.status === "running") {
      runningCount += 1;
    }
  }

  const hoursSinceLastSuccess = lastSuccessAt
    ? (now - new Date(lastSuccessAt).getTime()) / 3_600_000
    : Number.POSITIVE_INFINITY;

  const hoursSinceLastRun = lastRunAt
    ? (now - new Date(lastRunAt).getTime()) / 3_600_000
    : Number.POSITIVE_INFINITY;

  return {
    healthy: hoursSinceLastSuccess <= thresholdHours,
    lastSuccessAt,
    lastRunAt,
    hoursSinceLastSuccess: Math.round(hoursSinceLastSuccess * 10) / 10,
    hoursSinceLastRun: Math.round(hoursSinceLastRun * 10) / 10,
    totalRunsChecked: runs.length,
    successCount,
    failedCount,
    runningCount,
    thresholdHours,
    checkedAt,
  };
}

export function formatIngestionAlert(result: IngestionHealthResult): AiTodoNotePayload {
  const lines = [
    `[告警] Ingestion pipeline 已超过 ${result.hoursSinceLastSuccess === Number.POSITIVE_INFINITY ? "∞" : result.hoursSinceLastSuccess} 小时未成功运行。`,
    "",
  ];

  if (result.lastSuccessAt) {
    lines.push(`上次成功: ${result.lastSuccessAt} (${result.hoursSinceLastSuccess}h 前)`);
  } else {
    lines.push("上次成功: 无记录");
  }

  if (result.lastRunAt) {
    lines.push(`最近运行: ${result.lastRunAt} (${result.hoursSinceLastRun}h 前)`);
  }

  lines.push(
    `近期统计: ${result.successCount} 成功, ${result.failedCount} 失败, ${result.runningCount} 运行中`,
  );
  lines.push(`告警阈值: ${result.thresholdHours}h`);
  lines.push(`检查时间: ${result.checkedAt}`);

  return {
    title: lines.join("\n"),
    tags: ["monitoring", "ingestion_alert"],
  };
}
