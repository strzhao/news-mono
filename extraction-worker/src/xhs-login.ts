/**
 * One-time XHS login helper.
 *
 * Launches a visible Chrome window for the user to log into Xiaohongshu.
 * Saves the browser session state for use by the extraction worker.
 *
 * Usage: npm run xhs-login
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { launchInteractiveChrome } from "./browser-runtime.js";

const STATE_DIR = join(homedir(), ".xhs-session");
const STATE_FILE = join(STATE_DIR, "state.json");

async function main() {
  await mkdir(STATE_DIR, { recursive: true });

  console.log("Launching Chrome for XHS login...");
  console.log("Please log in to Xiaohongshu in the browser window.");
  console.log("The session will be saved automatically once you're logged in.\n");

  const browser = await launchInteractiveChrome();

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "zh-CN",
  });

  const page = await context.newPage();
  await page.goto("https://www.xiaohongshu.com", { waitUntil: "domcontentloaded" });

  let saved = false;

  async function saveState() {
    if (saved) return;
    try {
      await context.storageState({ path: STATE_FILE });
      saved = true;
      console.log(`\nSession saved to ${STATE_FILE}`);
      console.log("You can close the browser now. The extraction worker will use this session.");
    } catch (err) {
      console.error("Failed to save session:", err);
    }
  }

  // Poll for login success: check if cookies indicate logged-in state
  // Note: web_session exists for anonymous users too, so we need stronger signals
  const checkInterval = setInterval(async () => {
    try {
      const cookies = await context.cookies("https://www.xiaohongshu.com");
      const cookieNames = cookies.map((c) => c.name);

      // Strong login indicators (set only after real login)
      const hasStrongAuth = cookieNames.some((n) =>
        n === "customer-sso-sid" || n === "galaxy_creator_session_id" || n === "access-token-ark" || n === "customerClientId",
      );

      // Weaker signal: check if page DOM indicates logged-in state
      let hasPageAuth = false;
      if (!hasStrongAuth) {
        try {
          hasPageAuth = await page.evaluate(() => {
            // Logged-in users see their avatar/profile section instead of login prompt
            const hasLoginPrompt = document.body.innerText.includes("马上登录即可");
            const hasUserElement = document.querySelector("[class*=user-avatar], [class*=sidebar-user], [class*=avatar]") !== null;
            return hasUserElement && !hasLoginPrompt;
          });
        } catch {}
      }

      if ((hasStrongAuth || hasPageAuth) && !saved) {
        console.log(`Login detected! (cookies: ${hasStrongAuth ? cookieNames.filter(n => ["customer-sso-sid", "galaxy_creator_session_id", "access-token-ark", "customerClientId"].includes(n)).join(", ") : "page-based detection"})`);
        console.log("Saving session...");
        await saveState();
      }
    } catch {
      // Context might be closed
    }
  }, 2000);

  // Also save on browser close
  browser.on("disconnected", async () => {
    clearInterval(checkInterval);
    if (!saved) {
      console.log("\nBrowser closed without detecting login.");
      console.log("If you did log in, try running the script again.");
    }
    process.exit(0);
  });

  // Handle Ctrl+C
  process.on("SIGINT", async () => {
    clearInterval(checkInterval);
    await saveState();
    await browser.close().catch(() => {});
    process.exit(0);
  });

  // Keep alive
  await new Promise(() => {});
}

main().catch(console.error);
