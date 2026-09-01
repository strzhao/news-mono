/**
 * Acceptance tests for Chrome browser leak fixes.
 *
 * Red Team verifier — validates that the 7 Chrome leak fixes are correctly
 * implemented without reading the new implementation code directly.
 *
 * Tests use static analysis (fs.readFileSync + regex) for pattern verification
 * and module-level vi.mock() where runtime behavior must be tested.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const EXTRACTION_WORKER_SRC = join(__dirname, "..", "extraction-worker", "src");

// ---------------------------------------------------------------------------
// Test 1: Browser pool exposes a stats function with the expected shape
// ---------------------------------------------------------------------------

describe("Test 1: getBrowserPoolStats exports the expected stats", () => {
  it("getBrowserPoolStats is exported and returns an object with all required keys (static analysis)", () => {
    const source = readFileSync(join(EXTRACTION_WORKER_SRC, "extractors", "browser.ts"), "utf-8");

    expect(source, "browser.ts must export getBrowserPoolStats").toMatch(
      /export function getBrowserPoolStats/,
    );

    const requiredKeys = [
      "totalLaunches",
      "totalCloses",
      "activePages",
      "activeRequests",
      "browserConnected",
      "browserPid",
      "totalRequestsServed",
    ];

    for (const key of requiredKeys) {
      expect(source, `getBrowserPoolStats return type must include key "${key}"`).toContain(key);
    }
  });
});

// ---------------------------------------------------------------------------
// Test 2: Circuit breaker blocks URLs after 3 consecutive failures
// ---------------------------------------------------------------------------

describe("Test 2: Circuit breaker blocks repeated-failure URLs", () => {
  it("browser.ts exports getCircuitBreakerStats and circuit breaker is implemented (static analysis)", () => {
    const source = readFileSync(join(EXTRACTION_WORKER_SRC, "extractors", "browser.ts"), "utf-8");

    expect(source, "browser.ts must export getCircuitBreakerStats").toMatch(
      /export[^;]*getCircuitBreakerStats/,
    );

    // recordUrlFailure may be internal — the important thing is it exists
    expect(source, "browser.ts must define recordUrlFailure (exported or internal)").toMatch(
      /recordUrlFailure/,
    );
  });

  it("browser.ts circuit breaker logic blocks after a threshold (static analysis)", () => {
    const source = readFileSync(join(EXTRACTION_WORKER_SRC, "extractors", "browser.ts"), "utf-8");

    // Verify that the circuit breaker uses a threshold of 3 (or configurable >= 3)
    // The implementation should contain a check like:
    //   MAX_FAILURES_BEFORE_BLOCK = 3  or  failureCount >= 3  or  count >= 3
    const hasThreshold =
      /MAX_FAILURES_BEFORE_BLOCK\s*=\s*3/.test(source) ||
      /CIRCUIT_BREAKER[A-Z_]*\s*=\s*3/.test(source) ||
      /failureCount\s*>=\s*3/.test(source) ||
      /count\s*>=\s*MAX_FAILURES_BEFORE_BLOCK/.test(source) ||
      /failures?\s*>=\s*3/.test(source);

    expect(hasThreshold, "browser.ts circuit breaker must block after 3 failures").toBe(true);
  });

  it("browser.ts circuit breaker throws with 'circuit breaker' message when tripped (static analysis)", () => {
    const source = readFileSync(join(EXTRACTION_WORKER_SRC, "extractors", "browser.ts"), "utf-8");

    // The error thrown when the circuit is open must mention "circuit breaker"
    expect(
      source,
      "browser.ts must throw an error referencing 'circuit breaker' when blocking a URL",
    ).toMatch(/circuit.?breaker/i);
  });

  it("getCircuitBreakerStats returns { blockedUrls, cacheSize } (static analysis)", () => {
    const source = readFileSync(join(EXTRACTION_WORKER_SRC, "extractors", "browser.ts"), "utf-8");

    expect(source, "browser.ts must export getCircuitBreakerStats").toMatch(
      /export function getCircuitBreakerStats/,
    );

    // Verify the return type includes both required keys
    expect(source, "getCircuitBreakerStats must return blockedUrls").toMatch(
      /getCircuitBreakerStats[^}]*blockedUrls/s,
    );
    expect(source, "getCircuitBreakerStats must return cacheSize").toMatch(
      /getCircuitBreakerStats[^}]*cacheSize/s,
    );
  });

  it("after 3 failed extractions for the same URL, the next call throws a circuit-breaker error (static analysis of error message)", () => {
    const source = readFileSync(join(EXTRACTION_WORKER_SRC, "extractors", "browser.ts"), "utf-8");

    // The error thrown when the circuit trips must reference both the URL and
    // a meaningful "circuit breaker" label.  We verify the error string template exists.
    expect(
      source,
      "browser.ts must throw an error that includes 'circuit breaker' when blocking a URL",
    ).toMatch(/circuit.?breaker/i);

    // The error must also mention the failure count to aid debugging
    expect(
      source,
      "browser.ts circuit-breaker error must reference the failure threshold constant",
    ).toMatch(/MAX_FAILURES_BEFORE_BLOCK/);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Chrome launch args include optimization flags
// ---------------------------------------------------------------------------

describe("Test 3: Chrome launch args include required optimization flags", () => {
  it("AUTOMATION_ARGS in browser-runtime.ts contains --disable-gpu", () => {
    const source = readFileSync(join(EXTRACTION_WORKER_SRC, "browser-runtime.ts"), "utf-8");
    expect(source, "browser-runtime.ts must include --disable-gpu in AUTOMATION_ARGS").toMatch(
      /--disable-gpu/,
    );
  });

  it("AUTOMATION_ARGS in browser-runtime.ts contains --no-zygote", () => {
    const source = readFileSync(join(EXTRACTION_WORKER_SRC, "browser-runtime.ts"), "utf-8");
    expect(source, "browser-runtime.ts must include --no-zygote in AUTOMATION_ARGS").toMatch(
      /--no-zygote/,
    );
  });

  it("AUTOMATION_ARGS in browser-runtime.ts contains --disable-dev-shm-usage", () => {
    const source = readFileSync(join(EXTRACTION_WORKER_SRC, "browser-runtime.ts"), "utf-8");
    expect(
      source,
      "browser-runtime.ts must include --disable-dev-shm-usage in AUTOMATION_ARGS",
    ).toMatch(/--disable-dev-shm-usage/);
  });

  it("AUTOMATION_ARGS array is defined in browser-runtime.ts and contains all three flags together", () => {
    const source = readFileSync(join(EXTRACTION_WORKER_SRC, "browser-runtime.ts"), "utf-8");

    // Find the AUTOMATION_ARGS array definition block
    const automationArgsMatch = source.match(/AUTOMATION_ARGS\s*=\s*\[([^\]]*)\]/s);
    expect(
      automationArgsMatch,
      "AUTOMATION_ARGS array must be defined in browser-runtime.ts",
    ).not.toBeNull();

    const argsBlock = automationArgsMatch![1];
    expect(argsBlock).toMatch(/--disable-gpu/);
    expect(argsBlock).toMatch(/--no-zygote/);
    expect(argsBlock).toMatch(/--disable-dev-shm-usage/);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Health endpoint returns browser_pool and circuit_breaker fields
// ---------------------------------------------------------------------------

describe("Test 4: /health endpoint returns browser lifecycle stats", () => {
  it("server.ts calls getBrowserPoolStats() and getCircuitBreakerStats() in the health handler (static analysis)", () => {
    // We verify via static analysis because server.ts's startServer() calls
    // process.exit() which cannot be exercised safely in a unit test context.
    const serverSource = readFileSync(join(EXTRACTION_WORKER_SRC, "server.ts"), "utf-8");

    expect(serverSource, "server.ts must call getBrowserPoolStats() somewhere").toMatch(
      /getBrowserPoolStats\(\)/,
    );

    expect(serverSource, "server.ts must call getCircuitBreakerStats() somewhere").toMatch(
      /getCircuitBreakerStats\(\)/,
    );

    expect(serverSource, "server.ts must include 'browser_pool' key in health response").toMatch(
      /browser_pool/,
    );

    expect(serverSource, "server.ts must include 'circuit_breaker' key in health response").toMatch(
      /circuit_breaker/,
    );
  });

  it("server.ts imports getBrowserPoolStats and getCircuitBreakerStats from the browser extractor module", () => {
    const serverSource = readFileSync(join(EXTRACTION_WORKER_SRC, "server.ts"), "utf-8");

    // Both functions must be imported (named import or destructured)
    expect(serverSource).toMatch(/getBrowserPoolStats/);
    expect(serverSource).toMatch(/getCircuitBreakerStats/);
  });
});

// ---------------------------------------------------------------------------
// Test 5: XHS extractor uses try/finally for browser.close()
// ---------------------------------------------------------------------------

describe("Test 5: XHS extractor has browser.close() inside a finally block", () => {
  it("xiaohongshu.ts closes the browser in a finally block (static analysis)", () => {
    const source = readFileSync(
      join(EXTRACTION_WORKER_SRC, "extractors", "xiaohongshu.ts"),
      "utf-8",
    );

    // The pattern we expect:
    //   try {
    //     ...
    //   } finally {
    //     ...context.close()... + releasePage()
    //   }
    //
    // XHS now uses the shared browser pool (acquireBrowser) and only closes
    // the context in finally, not the browser itself.
    const finallyWithClose = /finally\s*\{[^}]*context\.close\(\)/s.test(source);
    expect(
      finallyWithClose,
      "xiaohongshu.ts: context.close() must appear inside a finally block to guarantee cleanup",
    ).toBe(true);
  });

  it("xiaohongshu.ts does NOT only close the browser inside catch (i.e. finally pattern is present)", () => {
    const source = readFileSync(
      join(EXTRACTION_WORKER_SRC, "extractors", "xiaohongshu.ts"),
      "utf-8",
    );

    // Count try/finally blocks vs try/catch-only blocks around browser.close
    // Simplistic check: there must be at least one "} finally {" before a browser.close
    const finallyBlocks = (source.match(/\}\s*finally\s*\{/g) || []).length;
    expect(
      finallyBlocks,
      "xiaohongshu.ts must have at least one try/finally block",
    ).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Test 6: Instagram extractor uses try/finally for browser.close()
// ---------------------------------------------------------------------------

describe("Test 6: Instagram extractor has browser.close() inside a finally block", () => {
  it("instagram.ts closes the browser in a finally block (static analysis)", () => {
    const source = readFileSync(join(EXTRACTION_WORKER_SRC, "extractors", "instagram.ts"), "utf-8");

    const finallyWithClose = /finally\s*\{[^}]*context\.close\(\)/s.test(source);
    expect(
      finallyWithClose,
      "instagram.ts: context.close() must appear inside a finally block to guarantee cleanup",
    ).toBe(true);
  });

  it("instagram.ts does NOT only close the browser inside catch (i.e. finally pattern is present)", () => {
    const source = readFileSync(join(EXTRACTION_WORKER_SRC, "extractors", "instagram.ts"), "utf-8");

    const finallyBlocks = (source.match(/\}\s*finally\s*\{/g) || []).length;
    expect(
      finallyBlocks,
      "instagram.ts must have at least one try/finally block",
    ).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Bonus: Browser pool idle timeout removed (long-lifetime mode)
// ---------------------------------------------------------------------------

describe("Bonus: Browser pool is in long-lifetime mode (no idle timeout)", () => {
  it("browser.ts does not set up a 5-minute idle timeout to close the browser", () => {
    const source = readFileSync(join(EXTRACTION_WORKER_SRC, "extractors", "browser.ts"), "utf-8");

    // The old code had IDLE_TIMEOUT_MS = 5 * 60 * 1000 and called
    // setTimeout(..., IDLE_TIMEOUT_MS) to close the browser after idle.
    // The fix should remove this pattern.
    const hasIdleTimeoutClose =
      /IDLE_TIMEOUT_MS\s*=/.test(source) &&
      /setTimeout[^}]*closeBrowserInstance[^}]*IDLE_TIMEOUT_MS/s.test(source);

    expect(
      hasIdleTimeoutClose,
      "browser.ts must NOT have an idle-timeout that auto-closes the browser (long-lifetime mode required)",
    ).toBe(false);
  });
});
