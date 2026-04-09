/**
 * Instagram session keep-alive.
 *
 * Loads the saved session, simulates natural browsing behavior,
 * and re-saves the refreshed session state (cookies get renewed).
 *
 * Anti-detection measures:
 *   - Random startup delay (0–10 min) to avoid fixed-interval patterns
 *   - Randomized viewport size
 *   - Random feed browsing: scroll, hover, like interaction areas
 *   - Occasionally view a post and go back
 *   - Human-like timing jitter between actions
 *
 * Usage: npm run ig-keep-alive
 * Recommended: run via cron every 12 hours.
 */

import { stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Page } from "playwright";
import { launchBackgroundBrowser } from "./browser-runtime.js";

const STATE_FILE = join(homedir(), ".instagram-session", "state.json");

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
  const jitter = ms * (0.5 + Math.random());
  return new Promise((r) => setTimeout(r, jitter));
}

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

async function humanScroll(page: Page) {
  const scrollCount = randInt(2, 6);
  for (let i = 0; i < scrollCount; i++) {
    const distance = randInt(200, 700);
    await page.mouse.wheel(0, distance);
    await sleep(randInt(800, 3000));
  }
}

async function humanHover(page: Page) {
  const hoverTargets = ["a", "img", "video", "[role='button']", "svg"];
  const selector = pickRandom(hoverTargets);
  try {
    const elements = await page.$$(selector);
    if (elements.length > 0) {
      const el = pickRandom(elements.slice(0, 10));
      await el.hover().catch(() => {});
      await sleep(randInt(300, 1500));
    }
  } catch {
    // ignore
  }
}

// Simulate random mouse movement
async function humanMouseMove(page: Page) {
  const moves = randInt(2, 4);
  for (let i = 0; i < moves; i++) {
    await page.mouse.move(randInt(100, 1200), randInt(100, 700));
    await sleep(randInt(200, 800));
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
  "https://www.instagram.com/",
  "https://www.instagram.com/explore/",
  "https://www.instagram.com/reels/",
];

async function main() {
  try {
    await stat(STATE_FILE);
  } catch {
    console.error("No session file found. Run 'npm run ig-login' first.");
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
      locale: "en-US",
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
    await sleep(randInt(2000, 5000));

    // Simulate browsing: mouse move + scroll + hover
    await humanMouseMove(page);
    await humanScroll(page);
    await humanHover(page);

    // Occasionally click into a post and go back (25% chance)
    if (Math.random() < 0.25) {
      try {
        const postLinks = await page.$$("a[href*='/p/'], a[href*='/reel/']");
        if (postLinks.length > 0) {
          const link = pickRandom(postLinks.slice(0, 8));
          await link.click();
          await sleep(randInt(2000, 6000));
          await humanScroll(page);
          await humanMouseMove(page);
          await page.goBack().catch(() => {});
          await sleep(randInt(1000, 3000));
        }
      } catch {
        // ignore
      }
    }

    // Occasionally visit notifications (15% chance)
    if (Math.random() < 0.15) {
      try {
        const notifLink = await page.$(
          "a[href*='/accounts/activity/'], svg[aria-label='Notifications']",
        );
        if (notifLink) {
          await notifLink.click();
          await sleep(randInt(1500, 4000));
          await humanScroll(page);
          await page.goBack().catch(() => {});
          await sleep(randInt(800, 2000));
        }
      } catch {
        // ignore
      }
    }

    // Check if still logged in
    const cookies = await context.cookies("https://www.instagram.com");
    const hasAuth = cookies.some((c) => c.name === "sessionid" || c.name === "ds_user_id");

    if (hasAuth) {
      await context.storageState({ path: STATE_FILE });
      console.log(
        `[${new Date().toISOString()}] Instagram session refreshed (${cookies.length} cookies, viewport ${viewport.width}x${viewport.height})`,
      );
    } else {
      console.error(
        `[${new Date().toISOString()}] Instagram session expired! Run 'npm run ig-login' to re-login.`,
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
