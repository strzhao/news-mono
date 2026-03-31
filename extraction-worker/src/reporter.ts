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

function normalizeBaseUrl(value: string): string {
  return String(value || "").trim().replace(/\/$/, "");
}

const ARTICLE_DB_BASE_URL = normalizeBaseUrl(process.env.ARTICLE_DB_BASE_URL || "");
const ARTICLE_DB_FALLBACK_BASE_URLS = String(process.env.ARTICLE_DB_FALLBACK_BASE_URLS || "")
  .split(",")
  .map((value) => normalizeBaseUrl(value))
  .filter(Boolean);
const ARTICLE_DB_BASE_URLS = Array.from(
  new Set([ARTICLE_DB_BASE_URL, ...ARTICLE_DB_FALLBACK_BASE_URLS].filter(Boolean)),
);
const ARTICLE_DB_API_TOKEN = process.env.ARTICLE_DB_API_TOKEN || "";

function authHeaders(): Record<string, string> {
  if (!ARTICLE_DB_API_TOKEN) return {};
  return { Authorization: `Bearer ${ARTICLE_DB_API_TOKEN}` };
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function describeBaseUrl(baseUrl: string): string {
  try {
    return new URL(baseUrl).host || baseUrl;
  } catch {
    return baseUrl;
  }
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 3,
): Promise<Response> {
  for (let i = 0; i < retries; i++) {
    let timeout: ReturnType<typeof setTimeout> | null = null;
    try {
      const controller = new AbortController();
      timeout = setTimeout(() => controller.abort(), 30_000);
      const response = await fetch(url, { ...init, signal: controller.signal });
      return response;
    } catch (error) {
      if (i === retries - 1) throw error;
      const delay = (i + 1) * 3000;
      console.log(`[reporter] Retry ${i + 1}/${retries} in ${delay}ms: ${error instanceof Error ? error.message : error}`);
      await new Promise((r) => setTimeout(r, delay));
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
  throw new Error("unreachable");
}

async function fetchArticleDb(
  path: string,
  init: RequestInit,
  retriesPerBase = 2,
): Promise<Response> {
  if (!ARTICLE_DB_BASE_URLS.length) {
    throw new Error("ARTICLE_DB_BASE_URL is not configured");
  }

  let lastError: Error | null = null;

  for (let index = 0; index < ARTICLE_DB_BASE_URLS.length; index++) {
    const baseUrl = ARTICLE_DB_BASE_URLS[index];
    const url = `${baseUrl}${path}`;
    const baseLabel = describeBaseUrl(baseUrl);
    const isLastBase = index === ARTICLE_DB_BASE_URLS.length - 1;

    try {
      const response = await fetchWithRetry(url, init, retriesPerBase);
      if (!response.ok && isRetryableStatus(response.status) && !isLastBase) {
        const responseText = await response.text().catch(() => "");
        console.warn(
          `[reporter] ${baseLabel} returned ${response.status}; failing over to ${describeBaseUrl(ARTICLE_DB_BASE_URLS[index + 1])}`,
        );
        if (responseText) {
          console.warn(`[reporter] Response body: ${responseText.slice(0, 500)}`);
        }
        continue;
      }

      if (index > 0) {
        console.log(`[reporter] Using fallback article-db base ${baseLabel}`);
      }
      return response;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (isLastBase) break;
      console.warn(
        `[reporter] ${baseLabel} failed; retrying with ${describeBaseUrl(ARTICLE_DB_BASE_URLS[index + 1])}: ${lastError.message}`,
      );
    }
  }

  throw lastError ?? new Error("article-db request failed");
}

export async function reportTaskComplete(taskId: string, payload: ReportPayload): Promise<void> {
  const response = await fetchArticleDb(`/api/v1/extract-url/${encodeURIComponent(taskId)}/complete`, {
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
  const response = await fetchArticleDb(`/api/v1/extract-url?limit=${limit}`, {
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
