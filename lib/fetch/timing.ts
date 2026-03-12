/**
 * Request timing utilities — jitter and delay functions for anti-detection.
 *
 * Replaces fixed delays with natural-looking timing patterns inspired by
 * xiaohongshu-cli (Gaussian jitter) and twitter-cli (uniform multiplier).
 */

/** Gaussian-distributed delay (Box-Muller transform). */
export function gaussianJitter(baseMs: number, sigma = 50): Promise<void> {
  const u1 = Math.random();
  const u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1 || 1e-10)) * Math.cos(2 * Math.PI * u2);
  const delay = Math.max(0, Math.round(baseMs + z * sigma));
  return new Promise((r) => setTimeout(r, delay));
}

/** Uniform-multiplier delay: base × random in [min, max]. */
export function uniformJitter(baseMs: number, min = 0.7, max = 1.5): Promise<void> {
  const multiplier = min + Math.random() * (max - min);
  const delay = Math.max(0, Math.round(baseMs * multiplier));
  return new Promise((r) => setTimeout(r, delay));
}

/**
 * Simulate reading pause — with `probability` chance, wait 2-5 seconds.
 * Mimics human browsing behavior where users occasionally pause to read.
 */
export async function readingPause(probability = 0.05): Promise<void> {
  if (Math.random() < probability) {
    const delay = 2000 + Math.random() * 3000;
    await new Promise((r) => setTimeout(r, delay));
  }
}
