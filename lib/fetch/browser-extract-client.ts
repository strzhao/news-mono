/**
 * Client for the browser-based extraction HTTP service.
 *
 * Calls the local Playwright extraction server (exposed via frp tunnel) to
 * render a URL in a real browser and return extracted content.
 *
 * Returns the same `ArticleContentPayload` shape as `fetchArticleContent` so
 * callers can use either interchangeably.
 */
import type { ArticleContentPayload, ArticleImageResource } from "./article-content-fetcher";
import { retryWithBackoff } from "./retry";

const DEFAULT_TIMEOUT_MS = 30_000;

interface BrowserServiceResponse {
  ok: boolean;
  data?: {
    source_url: string;
    resolved_url: string;
    title: string;
    text: string;
    html: string;
    images: Array<{ url: string; alt: string }>;
    author: string;
    published_at: string;
  };
  error?: string;
}

/**
 * Fetch article content via the browser extraction service.
 *
 * Requires `BROWSER_EXTRACT_URL` env var to be set (e.g. `http://VPS_HOST_INTERNAL:18081`).
 * Optionally uses `BROWSER_EXTRACT_AUTH_TOKEN` for bearer auth.
 *
 * @throws if the service is unavailable or returns an error
 */
export async function fetchViaBrowser(
  url: string,
  options?: { timeoutMs?: number; maxTextChars?: number; maxImages?: number },
): Promise<ArticleContentPayload> {
  const serviceUrl = process.env.BROWSER_EXTRACT_URL;
  if (!serviceUrl) {
    throw new Error("BROWSER_EXTRACT_URL not configured");
  }

  const authToken = process.env.BROWSER_EXTRACT_AUTH_TOKEN || "";
  const timeoutMs = options?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return retryWithBackoff(
    async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs + 5_000);

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (authToken) {
          headers.Authorization = `Bearer ${authToken}`;
        }

        const response = await fetch(`${serviceUrl}/extract`, {
          method: "POST",
          headers,
          body: JSON.stringify({
            url,
            timeout_ms: timeoutMs,
            max_text_chars: options?.maxTextChars,
            max_images: options?.maxImages,
          }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const text = await response.text().catch(() => "");
          throw new Error(
            `Browser extract service returned ${response.status}: ${text.slice(0, 200)}`,
          );
        }

        const result = (await response.json()) as BrowserServiceResponse;
        if (!result.ok || !result.data) {
          throw new Error(`Browser extract failed: ${result.error || "unknown error"}`);
        }

        const images: ArticleImageResource[] = (result.data.images || []).map((img) => ({
          url: img.url,
          alt: img.alt || "",
        }));

        return {
          sourceUrl: result.data.source_url || url,
          resolvedUrl: result.data.resolved_url || url,
          html: result.data.html || "",
          text: result.data.text || "",
          images,
        };
      } finally {
        clearTimeout(timer);
      }
    },
    { maxRetries: 1, baseDelayMs: 2000 },
  );
}
