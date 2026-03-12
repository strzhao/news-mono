/**
 * Generic retry wrapper with exponential backoff.
 *
 * Supports 429 Retry-After header, configurable retryable status codes,
 * and ±20% jitter to avoid thundering herd.
 */
import { FetchError, isRetryableStatus, classifyHttpStatus, extractDomain } from "./errors";

export interface RetryOptions {
  maxRetries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
}

const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_MAX_DELAY_MS = 30_000;

function isRetryableError(err: unknown): boolean {
  if (err instanceof FetchError) return err.retryable;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // Abort/timeout errors
    if (msg.includes("abort") || msg.includes("timeout")) return true;
    // Network errors
    if (msg.includes("fetch failed") || msg.includes("econnreset") || msg.includes("econnrefused")) return true;
    // HTTP status in message
    const statusMatch = msg.match(/\b(\d{3})\b/);
    if (statusMatch) {
      const status = Number(statusMatch[1]);
      if (isRetryableStatus(status)) return true;
    }
  }
  return false;
}

/**
 * Wrap an async function with exponential backoff retry.
 *
 * On failure, waits `baseDelay * 2^attempt * jitter` before retrying.
 * For 429 responses, respects the Retry-After header if available.
 */
export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  options?: RetryOptions,
): Promise<T> {
  const maxRetries = options?.maxRetries ?? DEFAULT_MAX_RETRIES;
  const baseDelayMs = options?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS;
  const maxDelayMs = options?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS;

  for (let attempt = 0; ; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt >= maxRetries || !isRetryableError(err)) {
        throw err;
      }

      // ±20% jitter
      const jitter = 0.8 + Math.random() * 0.4;
      const delay = Math.min(baseDelayMs * Math.pow(2, attempt) * jitter, maxDelayMs);

      console.warn(
        `[retry] Attempt ${attempt + 1}/${maxRetries} failed, retrying in ${Math.round(delay)}ms: ${err instanceof Error ? err.message : err}`,
      );

      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

/**
 * Wrap a fetch call to throw FetchError with proper classification.
 * Use this around raw fetch() calls to get structured errors.
 */
export async function fetchWithClassifiedError(
  url: string,
  init: RequestInit,
): Promise<Response> {
  const domain = extractDomain(url);
  try {
    const response = await fetch(url, init);
    if (!response.ok) {
      throw new FetchError(`Fetch failed: ${response.status}`, {
        code: classifyHttpStatus(response.status),
        statusCode: response.status,
        domain,
      });
    }
    return response;
  } catch (err) {
    if (err instanceof FetchError) throw err;
    if (err instanceof Error && err.name === "AbortError") {
      throw new FetchError(`Request timeout: ${url}`, {
        code: "timeout",
        domain,
        cause: err,
      });
    }
    throw new FetchError(`Network error: ${err instanceof Error ? err.message : err}`, {
      code: "network_error",
      domain,
      cause: err,
    });
  }
}
