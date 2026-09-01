// Reports extraction results back to article-db.

interface ExtractedResource {
  type: string;
  url: string;
  filename: string;
  size_bytes: number;
  mime_type: string;
  language?: string;
  format?: string;
  expires_at?: string;
}

interface ExtractionMetadata {
  title: string;
  description: string;
  author: string;
  duration?: number;
  published_at?: string;
  platform_id?: string;
  tags?: string[];
}

interface ReportPayload {
  resources?: ExtractedResource[];
  metadata?: ExtractionMetadata;
  error_message?: string;
}

const ARTICLE_DB_BASE_URL = process.env.ARTICLE_DB_BASE_URL || "";
const ARTICLE_DB_API_TOKEN = process.env.ARTICLE_DB_API_TOKEN || "";

function authHeaders(): Record<string, string> {
  if (!ARTICLE_DB_API_TOKEN) return {};
  return { Authorization: `Bearer ${ARTICLE_DB_API_TOKEN}` };
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 3,
): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30_000);
      const response = await fetch(url, { ...init, signal: controller.signal });
      clearTimeout(timeout);
      return response;
    } catch (error) {
      if (i === retries - 1) throw error;
      const delay = (i + 1) * 3000;
      console.log(`[reporter] Retry ${i + 1}/${retries} in ${delay}ms: ${error instanceof Error ? error.message : error}`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw new Error("unreachable");
}

export async function reportTaskComplete(taskId: string, payload: ReportPayload): Promise<void> {
  const url = `${ARTICLE_DB_BASE_URL}/api/v1/extract-url/${encodeURIComponent(taskId)}/complete`;
  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...authHeaders(),
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Report failed (${response.status}): ${text}`);
  }
}

interface PendingTask {
  task_id: string;
  url: string;
  platform: string;
  status: string;
  blob_ttl_hours: number;
}

export async function fetchPendingTasks(limit = 5): Promise<PendingTask[]> {
  const url = `${ARTICLE_DB_BASE_URL}/api/v1/extract-url?limit=${limit}`;
  const response = await fetchWithRetry(url, {
    method: "GET",
    headers: {
      Accept: "application/json",
      ...authHeaders(),
    },
  });

  if (!response.ok) {
    throw new Error(`Fetch pending tasks failed: ${response.status}`);
  }

  const payload = (await response.json()) as { ok: boolean; tasks: PendingTask[] };
  return payload.ok ? payload.tasks : [];
}
