/**
 * Adaptive per-domain throttling.
 *
 * Tracks rate-limit signals per domain and dynamically adjusts request
 * delays. On throttle signals (429/403/461/471), doubles the delay
 * multiplier. On sustained success, slowly recovers.
 */
import { gaussianJitter } from "./timing";

interface DomainState {
  multiplier: number;
  successCount: number;
  degraded: boolean;
  captchaHit: boolean;
}

const MAX_MULTIPLIER = 8;
const RECOVERY_INTERVAL = 10; // successes before reducing multiplier
const RECOVERY_FACTOR = 0.9;

export class AdaptiveThrottle {
  private domains = new Map<string, DomainState>();
  private baseDelayMs: number;

  constructor(baseDelayMs = 200) {
    this.baseDelayMs = baseDelayMs;
  }

  private getState(domain: string): DomainState {
    let state = this.domains.get(domain);
    if (!state) {
      state = { multiplier: 1, successCount: 0, degraded: false, captchaHit: false };
      this.domains.set(domain, state);
    }
    return state;
  }

  /** Wait the appropriate delay for this domain before making a request. */
  async wait(domain: string): Promise<void> {
    const state = this.getState(domain);
    const effectiveDelay = this.baseDelayMs * state.multiplier;
    await gaussianJitter(effectiveDelay, effectiveDelay * 0.3);
  }

  /** Report a successful request — slowly recover the multiplier. */
  onSuccess(domain: string): void {
    const state = this.getState(domain);
    state.successCount++;
    if (state.successCount >= RECOVERY_INTERVAL && state.multiplier > 1) {
      state.multiplier = Math.max(1, state.multiplier * RECOVERY_FACTOR);
      state.successCount = 0;
    }
  }

  /** Report a throttle signal — double the multiplier. */
  onThrottle(domain: string): void {
    const state = this.getState(domain);
    state.multiplier = Math.min(MAX_MULTIPLIER, state.multiplier * 2);
    state.successCount = 0;
    if (state.multiplier >= MAX_MULTIPLIER) {
      state.degraded = true;
    }
  }

  /** Report a captcha detection — permanently double base delay for this run. */
  onCaptcha(domain: string): void {
    const state = this.getState(domain);
    state.captchaHit = true;
    state.multiplier = Math.min(MAX_MULTIPLIER, state.multiplier * 2);
    state.successCount = 0;
  }

  /** Check if a domain is degraded (hit max multiplier). */
  isDegraded(domain: string): boolean {
    return this.getState(domain).degraded;
  }

  /** Get current stats for logging/telemetry. */
  getStats(): Record<string, { multiplier: number; degraded: boolean; captchaHit: boolean }> {
    const result: Record<string, { multiplier: number; degraded: boolean; captchaHit: boolean }> =
      {};
    for (const [domain, state] of this.domains) {
      result[domain] = {
        multiplier: Math.round(state.multiplier * 100) / 100,
        degraded: state.degraded,
        captchaHit: state.captchaHit,
      };
    }
    return result;
  }
}

/** HTTP status codes that indicate throttling. */
export function isThrottleSignal(status: number): boolean {
  return status === 429 || status === 403 || status === 461 || status === 471;
}
