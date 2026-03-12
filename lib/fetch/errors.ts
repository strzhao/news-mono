/**
 * Structured fetch error types for crawling pipeline.
 *
 * Provides typed error codes so retry/throttle logic can make informed
 * decisions without parsing error messages.
 */

export type FetchErrorCode =
  | "rate_limited"
  | "captcha_blocked"
  | "timeout"
  | "upstream_error"
  | "network_error"
  | "content_type_mismatch"
  | "unknown";

const RETRYABLE_CODES = new Set<FetchErrorCode>([
  "rate_limited",
  "timeout",
  "upstream_error",
  "network_error",
]);

const RETRYABLE_STATUS_CODES = new Set([408, 429, 500, 502, 503, 504]);

export class FetchError extends Error {
  readonly code: FetchErrorCode;
  readonly statusCode: number | undefined;
  readonly retryable: boolean;
  readonly domain: string;

  constructor(
    message: string,
    opts: {
      code: FetchErrorCode;
      statusCode?: number;
      domain?: string;
      cause?: unknown;
    },
  ) {
    super(message, { cause: opts.cause });
    this.name = "FetchError";
    this.code = opts.code;
    this.statusCode = opts.statusCode;
    this.domain = opts.domain ?? "";
    this.retryable = RETRYABLE_CODES.has(opts.code);
  }
}

/** Classify an HTTP status code into a FetchErrorCode. */
export function classifyHttpStatus(status: number): FetchErrorCode {
  if (status === 429) return "rate_limited";
  if (status === 461 || status === 471) return "captcha_blocked";
  if (status === 408) return "timeout";
  if (status >= 500) return "upstream_error";
  return "unknown";
}

/** Check if an HTTP status code is retryable. */
export function isRetryableStatus(status: number): boolean {
  return RETRYABLE_STATUS_CODES.has(status);
}

/** Extract domain from a URL string (best-effort). */
export function extractDomain(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}
