// Extraction Worker — polls article-db for pending tasks and processes them,
// and optionally starts an HTTP server for browser-based content extraction.
//
// Prerequisites:
//   - yt-dlp installed (brew install yt-dlp / pip install yt-dlp)
//   - ffmpeg installed (brew install ffmpeg)
//   - Environment variables: ARTICLE_DB_BASE_URL, ARTICLE_DB_API_TOKEN, BLOB_READ_WRITE_TOKEN
//
// Usage:
//   npm start              # run once (process all pending tasks, then exit)
//   npm run dev            # watch mode with auto-reload
//   npm run server         # start browser extract HTTP server only (local debugging)
//   npm run server-poll    # start HTTP server + continuous polling
//
// For long-running service mode, use PM2 with ecosystem.config.cjs.
// Manual `npm run server` should not be used as the production process owner.
// For one-off polling, use a cron job:
//   crontab: every-5-min cd /path/to/extraction-worker && npm start

import { ProxyAgent, setGlobalDispatcher } from "undici";

// Auto-detect system proxy and apply to Node.js fetch
const proxyUrl = process.env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.log(`  Proxy: ${proxyUrl}`);
}

import { fetchPendingTasks, reportTaskComplete } from "./reporter.js";
import { extractYouTube } from "./extractors/youtube.js";
import { extractBilibili } from "./extractors/bilibili.js";
import { extractXiaohongshu } from "./extractors/xiaohongshu.js";
import { extractInstagram } from "./extractors/instagram.js";
import { startServer } from "./server.js";
import { warnIfBackgroundBrowserMissing } from "./browser-runtime.js";

const SERVER_MODE = process.argv.includes("--server");
const POLL_MODE = process.argv.includes("--poll");
const POLL_INTERVAL_MS = 30_000;
const ARTICLE_DB_BASE_URL = process.env.ARTICLE_DB_BASE_URL || "";
const ARTICLE_DB_FALLBACK_BASE_URLS = String(process.env.ARTICLE_DB_FALLBACK_BASE_URLS || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

async function processTask(task: { task_id: string; url: string; platform: string; blob_ttl_hours: number }): Promise<void> {
  console.log(`[${task.task_id}] Processing ${task.platform}: ${task.url}`);

  try {
    let result: { resources: any[]; metadata: any };

    switch (task.platform) {
      case "youtube":
        result = await extractYouTube(task.url, task.task_id, task.blob_ttl_hours);
        break;
      case "bilibili":
        result = await extractBilibili(task.url, task.task_id, task.blob_ttl_hours);
        break;
      case "xiaohongshu":
        result = await extractXiaohongshu(task.url, task.task_id, task.blob_ttl_hours);
        break;
      case "instagram":
        result = await extractInstagram(task.url, task.task_id, task.blob_ttl_hours);
        break;
      default:
        throw new Error(`Unsupported platform: ${task.platform}`);
    }

    console.log(`[${task.task_id}] Extracted ${result.resources.length} resources. Reporting...`);

    await reportTaskComplete(task.task_id, {
      resources: result.resources,
      metadata: result.metadata,
    });

    console.log(`[${task.task_id}] Done.`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[${task.task_id}] Failed: ${message}`);

    await reportTaskComplete(task.task_id, {
      error_message: message.slice(0, 2000),
    }).catch((err) => {
      console.error(`[${task.task_id}] Failed to report error: ${err}`);
    });
  }
}

async function runOnce(): Promise<number> {
  try {
    const tasks = await fetchPendingTasks(5);
    if (!tasks.length) {
      console.log("No pending tasks.");
      return 0;
    }

    console.log(`Found ${tasks.length} pending task(s).`);
    for (const task of tasks) {
      await processTask(task);
    }
    return tasks.length;
  } catch (error) {
    console.error("Error fetching tasks:", error);
    return 0;
  }
}

async function main(): Promise<void> {
  const modes: string[] = [];
  if (SERVER_MODE) modes.push("HTTP server");
  if (POLL_MODE) modes.push("continuous polling");
  if (!modes.length) modes.push("single run");

  console.log("Extraction Worker started.");
  console.log(`  ARTICLE_DB_BASE_URL: ${ARTICLE_DB_BASE_URL || "(not set)"}`);
  if (ARTICLE_DB_FALLBACK_BASE_URLS.length) {
    console.log(`  ARTICLE_DB_FALLBACK_BASE_URLS: ${ARTICLE_DB_FALLBACK_BASE_URLS.join(", ")}`);
  }
  console.log(`  Mode: ${modes.join(" + ")}`);
  await warnIfBackgroundBrowserMissing();

  // Start HTTP server if requested (does not block)
  if (SERVER_MODE) {
    startServer();
  }

  // Task polling requires ARTICLE_DB_BASE_URL
  if (POLL_MODE || !SERVER_MODE) {
    if (!ARTICLE_DB_BASE_URL) {
      console.error("Error: ARTICLE_DB_BASE_URL is required for task polling.");
      if (!SERVER_MODE) process.exit(1);
      return;
    }
  }

  if (POLL_MODE) {
    // Continuous polling mode
    while (true) {
      await runOnce();
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  } else if (!SERVER_MODE) {
    // Single run mode (for cron jobs)
    await runOnce();
  }
  // If SERVER_MODE only, main() returns and the HTTP server keeps the process alive
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
