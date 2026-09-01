import type {
  ExtractedResource,
  ExtractionMetadata,
  ExtractionTask,
} from "@/lib/domain/url-extraction-models";
import type { UpstashClient } from "./upstash";

const TASK_KEY_PREFIX = "extraction:task:";
const PENDING_QUEUE_KEY = "extraction:pending";
const USER_TASKS_PREFIX = "extraction:user:";
const TASK_TTL_SECONDS = 7 * 24 * 3600;

function taskKey(taskId: string): string {
  return `${TASK_KEY_PREFIX}${taskId}`;
}

function userTasksKey(userId: string): string {
  return `${USER_TASKS_PREFIX}${userId}`;
}

export async function enqueueExtractionTask(
  redis: UpstashClient,
  task: ExtractionTask,
): Promise<void> {
  const serialized: Record<string, string> = {
    task_id: task.task_id,
    url: task.url,
    platform: task.platform,
    status: task.status,
    user_id: task.user_id,
    resources: JSON.stringify(task.resources),
    metadata: JSON.stringify(task.metadata),
    created_at: task.created_at,
    blob_ttl_hours: String(task.blob_ttl_hours),
  };
  if (task.error_message) {
    serialized.error_message = task.error_message;
  }

  await redis.hset(taskKey(task.task_id), serialized);
  await redis.expire(taskKey(task.task_id), TASK_TTL_SECONDS);
  // Add to pending queue (sorted set with created_at as score)
  await redis.zadd(PENDING_QUEUE_KEY, Date.now(), task.task_id);
  // Add to user index
  if (task.user_id) {
    await redis.zadd(userTasksKey(task.user_id), Date.now(), task.task_id);
  }
}

/** Save a task that completed immediately (webpage/twitter) to Redis + user index. */
export async function saveCompletedTask(redis: UpstashClient, task: ExtractionTask): Promise<void> {
  const serialized: Record<string, string> = {
    task_id: task.task_id,
    url: task.url,
    platform: task.platform,
    status: task.status,
    user_id: task.user_id,
    resources: JSON.stringify(task.resources),
    metadata: JSON.stringify(task.metadata),
    created_at: task.created_at,
    blob_ttl_hours: String(task.blob_ttl_hours),
  };
  if (task.completed_at) serialized.completed_at = task.completed_at;
  if (task.error_message) serialized.error_message = task.error_message;
  if (task.ai_summary) serialized.ai_summary = task.ai_summary;

  await redis.hset(taskKey(task.task_id), serialized);
  await redis.expire(taskKey(task.task_id), TASK_TTL_SECONDS);
  if (task.user_id) {
    await redis.zadd(userTasksKey(task.user_id), Date.now(), task.task_id);
  }
}

/** List all tasks for a user, newest first. */
export async function listUserTasks(
  redis: UpstashClient,
  userId: string,
  limit = 50,
): Promise<ExtractionTask[]> {
  const taskIds = await redis.zrevrange(userTasksKey(userId), 0, limit - 1);
  if (!taskIds.length) return [];

  const tasks: ExtractionTask[] = [];
  for (const id of taskIds) {
    const task = await getExtractionTask(redis, id);
    if (task) tasks.push(task);
  }
  return tasks;
}

export async function getExtractionTask(
  redis: UpstashClient,
  taskId: string,
): Promise<ExtractionTask | null> {
  const raw = await redis.hgetall(taskKey(taskId));
  if (!raw?.task_id) {
    return null;
  }
  return deserializeTask(raw);
}

export async function listPendingTasks(redis: UpstashClient, limit = 5): Promise<ExtractionTask[]> {
  const taskIds = await redis.zrevrange(PENDING_QUEUE_KEY, 0, limit - 1);
  if (!taskIds.length) {
    return [];
  }
  const tasks: ExtractionTask[] = [];
  for (const id of taskIds) {
    const task = await getExtractionTask(redis, id);
    if (task && task.status === "pending") {
      tasks.push(task);
    }
  }
  return tasks;
}

export async function updateTaskStatus(
  redis: UpstashClient,
  taskId: string,
  status: "processing" | "completed" | "failed",
  extra?: {
    resources?: ExtractedResource[];
    metadata?: ExtractionMetadata;
    error_message?: string;
  },
): Promise<void> {
  const updates: Record<string, string> = { status };
  if (status === "completed" || status === "failed") {
    updates.completed_at = new Date().toISOString();
    // Remove from pending queue
    await redis.command(["ZREM", PENDING_QUEUE_KEY, taskId]);
  }
  if (extra?.resources) {
    updates.resources = JSON.stringify(extra.resources);
  }
  if (extra?.metadata) {
    updates.metadata = JSON.stringify(extra.metadata);
  }
  if (extra?.error_message) {
    updates.error_message = extra.error_message;
  }
  await redis.hset(taskKey(taskId), updates);
}

export async function listExpiredTaskIds(redis: UpstashClient): Promise<string[]> {
  // Scan all task keys that are completed and past their TTL
  // For simplicity, we use a secondary sorted set tracking completion times
  // This will be populated when tasks complete
  const completedKey = "extraction:completed";
  const cutoff = Date.now() - 72 * 3600 * 1000; // default 72h
  const responses = await redis.command(["ZRANGEBYSCORE", completedKey, "0", String(cutoff)]);
  if (!Array.isArray(responses)) {
    return [];
  }
  return responses.map((item) => String(item)).filter(Boolean);
}

function deserializeTask(raw: Record<string, string>): ExtractionTask {
  return {
    task_id: raw.task_id || "",
    url: raw.url || "",
    platform: raw.platform as ExtractionTask["platform"],
    status: raw.status as ExtractionTask["status"],
    user_id: raw.user_id || "",
    resources: safeJsonParse(raw.resources, []),
    metadata: safeJsonParse(raw.metadata, {
      title: "",
      description: "",
      author: "",
    }),
    created_at: raw.created_at || "",
    completed_at: raw.completed_at || undefined,
    error_message: raw.error_message || undefined,
    blob_ttl_hours: Number(raw.blob_ttl_hours) || 72,
    ai_summary: raw.ai_summary || undefined,
  };
}

function safeJsonParse<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}
