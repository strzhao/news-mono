/**
 * HTTP server for browser-based content extraction.
 *
 * Endpoints:
 *   POST /extract  — render a URL via Playwright and return extracted content
 *   GET  /health   — liveness check
 *
 * Auth: Bearer token via BROWSER_EXTRACT_AUTH_TOKEN env var.
 * Port: BROWSER_EXTRACT_PORT env var (default 3100).
 */
import http from "node:http";
import {
  type BrowserExtractOptions,
  type BrowserExtractResult,
  closeBrowserPool,
  extractWithBrowser,
} from "./extractors/browser.js";

const PORT = Number(process.env.BROWSER_EXTRACT_PORT) || 3100;
const AUTH_TOKEN = process.env.BROWSER_EXTRACT_AUTH_TOKEN || "";
const startedAt = Date.now();

function formatError(error: unknown): string {
  if (error instanceof Error) return error.stack || `${error.name}: ${error.message}`;
  return String(error);
}

function closeHttpServer(server: http.Server): Promise<void> {
  return new Promise((resolve) => {
    const forceCloseTimer = setTimeout(() => {
      console.warn("[server] Force-closing open connections after shutdown timeout");
      server.closeAllConnections?.();
    }, 5_000);
    forceCloseTimer.unref();

    server.close((error) => {
      clearTimeout(forceCloseTimer);
      if (error) {
        console.error(`[server] Error while closing HTTP server: ${formatError(error)}`);
      } else {
        console.log("[server] HTTP server closed");
      }
      resolve();
    });

    server.closeIdleConnections?.();
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX = 1_048_576; // 1 MB
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
    req.on("error", reject);
  });
}

function checkAuth(req: http.IncomingMessage): boolean {
  if (!AUTH_TOKEN) return true; // no auth configured
  const header = req.headers.authorization || "";
  return header === `Bearer ${AUTH_TOKEN}`;
}

// ---------------------------------------------------------------------------
// Route handlers
// ---------------------------------------------------------------------------

async function handleExtract(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const raw = await readBody(req);
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(raw);
  } catch {
    json(res, 400, { ok: false, error: "Invalid JSON body" });
    return;
  }

  const url = String(body.url || "").trim();
  if (!url) {
    json(res, 400, { ok: false, error: "Missing url" });
    return;
  }

  const options: BrowserExtractOptions = {};
  if (body.timeout_ms) options.timeoutMs = Number(body.timeout_ms);
  if (body.max_text_chars) options.maxTextChars = Number(body.max_text_chars);
  if (body.max_images) options.maxImages = Number(body.max_images);

  console.log(`[server] POST /extract url=${url}`);
  const start = Date.now();

  try {
    const result: BrowserExtractResult = await extractWithBrowser(url, options);
    console.log(
      `[server] Extracted "${result.title}" (${result.text.length} chars, ${result.images.length} imgs) in ${Date.now() - start}ms`,
    );
    json(res, 200, { ok: true, data: result });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[server] Extract failed for ${url}: ${message}`);
    json(res, 500, { ok: false, error: message });
  }
}

function handleHealth(_req: http.IncomingMessage, res: http.ServerResponse): void {
  json(res, 200, {
    ok: true,
    uptime_seconds: Math.floor((Date.now() - startedAt) / 1000),
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

export function startServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    const method = req.method || "";
    const pathname = (req.url || "").split("?")[0];

    // CORS preflight
    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    // Auth check
    if (!checkAuth(req)) {
      json(res, 401, { ok: false, error: "Unauthorized" });
      return;
    }

    try {
      if (method === "POST" && pathname === "/extract") {
        await handleExtract(req, res);
      } else if (method === "GET" && pathname === "/health") {
        handleHealth(req, res);
      } else {
        json(res, 404, { ok: false, error: "Not found" });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      json(res, 500, { ok: false, error: message });
    }
  });

  server.listen(PORT, () => {
    console.log(`[server] Browser extract server listening on port ${PORT}`);
    if (AUTH_TOKEN) {
      console.log(`[server] Auth: Bearer token enabled`);
    } else {
      console.log(`[server] Auth: disabled (no BROWSER_EXTRACT_AUTH_TOKEN)`);
    }
  });

  let shutdownPromise: Promise<void> | null = null;

  const shutdown = (reason: string, exitCode: number, error?: unknown): Promise<void> => {
    if (shutdownPromise) {
      console.log(`[server] Shutdown already in progress (reason=${reason})`);
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      if (error) {
        console.error(`[server] Shutdown triggered by ${reason}: ${formatError(error)}`);
      } else {
        console.log(`[server] Shutdown triggered by ${reason}`);
      }

      await closeHttpServer(server);
      await closeBrowserPool(reason).catch((closeError) => {
        console.error(
          `[server] Failed to close browser pool during ${reason}: ${formatError(closeError)}`,
        );
      });
      process.exit(exitCode);
    })();

    return shutdownPromise;
  };

  process.on("SIGINT", () => {
    void shutdown("SIGINT", 0);
  });
  process.on("SIGTERM", () => {
    void shutdown("SIGTERM", 0);
  });
  process.on("SIGHUP", () => {
    void shutdown("SIGHUP", 0);
  });
  process.on("uncaughtException", (error) => {
    void shutdown("uncaughtException", 1, error);
  });
  process.on("unhandledRejection", (reason) => {
    void shutdown("unhandledRejection", 1, reason);
  });

  return server;
}
