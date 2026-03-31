/**
 * One-time Instagram login helper.
 *
 * Launches a visible Chrome window for the user to log into Instagram.
 * Saves the browser session state for use by the extraction worker.
 *
 * Usage: npm run ig-login
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { launchInteractiveChrome } from "./browser-runtime.js";

const STATE_DIR = join(homedir(), ".instagram-session");
const STATE_FILE = join(STATE_DIR, "state.json");

async function main() {
  await mkdir(STATE_DIR, { recursive: true });

  console.log("Launching Chrome for Instagram login...");
  console.log("Please log in to Instagram in the browser window.");
  console.log("The session will be saved automatically once you're logged in.\n");

  const browser = await launchInteractiveChrome();

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    locale: "en-US",
  });

  const page = await context.newPage();
  await page.goto("https://www.instagram.com/accounts/login/", { waitUntil: "domcontentloaded" });

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
  const checkInterval = setInterval(async () => {
    try {
      const cookies = await context.cookies("https://www.instagram.com");
      // Instagram sets sessionid cookie after login
      const hasAuth = cookies.some(
        (c) => c.name === "sessionid" || c.name === "ds_user_id",
      );
      if (hasAuth && !saved) {
        console.log("Login detected! Saving session...");
        await saveState();
      }
    } catch {
      // Context might be closed
    }
  }, 2000);

  browser.on("disconnected", async () => {
    clearInterval(checkInterval);
    if (!saved) {
      console.log("\nBrowser closed without detecting login.");
      console.log("If you did log in, try running the script again.");
    }
    process.exit(0);
  });

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
