/**
 * XHS session keep-alive.
 *
 * Loads the saved session, simulates natural browsing behavior,
 * and re-saves the refreshed session state (cookies get renewed).
 *
 * Anti-detection measures:
 *   - Random startup delay (0–10 min) to avoid fixed-interval patterns
 *   - Randomized viewport size
 *   - Random page browsing: scroll, hover, click into notes
 *   - Human-like timing jitter between actions
 *
 * Usage: npm run xhs-keep-alive
 * Recommended: run via cron every 12 hours.
 */

import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { launchBackgroundBrowser } from "./browser-runtime.js";

const STATE_FILE = join(homedir(), ".xhs-session", "state.json");

// Random integer in [min, max]
function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// Sleep with human-like jitter
function sleep(ms: number): Promise<void> {
  const jitter = ms * (0.5 + Math.random()); // 50%–150% of target
  return new Promise((r) => setTimeout(r, jitter));
}

// Pick a random item from an array
function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Simulate human-like scrolling
async function humanScroll(page: Page) {
  const scrollCount = randInt(2, 5);
  for (let i = 0; i < scrollCount; i++) {
    const distance = randInt(200, 600);
    await page.mouse.wheel(0, distance);
    await sleep(randInt(800, 2500));
  }
}

// Simulate hovering over random elements
async function humanHover(page: Page) {
  const hoverTargets = ["a", "img", ".note-item", "[class*=card]", "[class*=feed]"];
  const selector = pickRandom(hoverTargets);
  try {
    const elements = await page.$$(selector);
    if (elements.length > 0) {
      const el = pickRandom(elements.slice(0, 10));
      await el.hover().catch(() => {});
      await sleep(randInt(300, 1200));
    }
  } catch {
    // ignore
  }
}

const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 },
  { width: 1366, height: 768 },
  { width: 1280, height: 800 },
];

const ENTRY_PAGES = [
  "https://www.xiaohongshu.com",
  "https://www.xiaohongshu.com/explore",
  "https://www.xiaohongshu.com/explore?channel_id=homefeed_recommend",
];

async function main() {
  // Check session file exists
  try {
    await stat(STATE_FILE);
  } catch {
    console.error("No session file found. Run 'npm run xhs-login' first.");
    process.exit(1);
  }

  // Random startup delay: 0–10 minutes
  const delayMs = randInt(0, 10 * 60 * 1000);
  console.log(
    `[${new Date().toISOString()}] Waiting ${Math.round(delayMs / 1000)}s before starting...`,
  );
  await new Promise((r) => setTimeout(r, delayMs));

  const viewport = pickRandom(VIEWPORTS);

  const browser = await launchBackgroundBrowser();

  try {
    const context = await browser.newContext({
      storageState: STATE_FILE,
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      locale: "zh-CN",
      viewport,
    });

    const page = await context.newPage();

    // Anti-detection: hide webdriver flag
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });

    // Visit a random entry page
    const entryUrl = pickRandom(ENTRY_PAGES);
    await page.goto(entryUrl, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForLoadState("networkidle").catch(() => {});
    await sleep(randInt(1500, 4000));

    // Simulate browsing: scroll + hover
    await humanScroll(page);
    await humanHover(page);

    // Occasionally click into a note and go back (30% chance)
    if (Math.random() < 0.3) {
      try {
        const noteLinks = await page.$$("a[href*='/explore/'], a[href*='/discovery/item/']");
        if (noteLinks.length > 0) {
          const link = pickRandom(noteLinks.slice(0, 8));
          await link.click();
          await sleep(randInt(2000, 5000));
          await humanScroll(page);
          await page.goBack().catch(() => {});
          await sleep(randInt(1000, 2500));
        }
      } catch {
        // ignore click failures
      }
    }

    // Check if still logged in
    const cookies = await context.cookies("https://www.xiaohongshu.com");
    const hasAuth = cookies.some(
      (c) =>
        c.name === "web_session" ||
        c.name === "customer-sso-sid" ||
        c.name === "galaxy_creator_session_id",
    );

    if (hasAuth) {
      await context.storageState({ path: STATE_FILE });
      console.log(
        `[${new Date().toISOString()}] XHS session refreshed (${cookies.length} cookies, viewport ${viewport.width}x${viewport.height})`,
      );
    } else {
      console.error(
        `[${new Date().toISOString()}] XHS session expired! Run 'npm run xhs-login' to re-login.`,
      );
      process.exit(1);
    }

    await context.close();
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] Keep-alive failed:`, err.message);
  process.exit(1);
});
