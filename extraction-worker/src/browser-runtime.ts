import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { type Browser, chromium, type LaunchOptions } from "playwright";

const BACKGROUND_BROWSER_KIND = "chromium";
const INTERACTIVE_BROWSER_KIND = "chrome";
const BACKGROUND_BROWSER_INSTALL_COMMAND = "npm run install:chromium";
const AUTOMATION_ARGS = [
  "--disable-blink-features=AutomationControlled",
  "--disable-gpu",
  "--disable-dev-shm-usage",
  "--no-zygote",
  "--disable-breakpad",
  "--disable-component-update",
  "--disable-default-apps",
  "--disable-extensions",
  "--no-first-run",
];

function currentProxyServer(): string | undefined {
  return (
    process.env.https_proxy ||
    process.env.HTTPS_PROXY ||
    process.env.http_proxy ||
    process.env.HTTP_PROXY ||
    undefined
  );
}

function mergeArgs(defaultArgs: string[], extraArgs?: string[]): string[] {
  return Array.from(new Set([...defaultArgs, ...(extraArgs ?? [])]));
}

function formatLaunchError(error: unknown, browserKind: string): string {
  const message = error instanceof Error ? error.message : String(error);
  if (browserKind === BACKGROUND_BROWSER_KIND && message.includes("Executable doesn't exist")) {
    return `${message}\nRun '${BACKGROUND_BROWSER_INSTALL_COMMAND}' to install the ${browserKind} runtime used by extraction-worker background jobs.`;
  }
  return message;
}

async function launchBrowser(launchOptions: LaunchOptions, browserKind: string): Promise<Browser> {
  try {
    return await chromium.launch(launchOptions);
  } catch (error) {
    throw new Error(formatLaunchError(error, browserKind), { cause: error });
  }
}

export function getBackgroundBrowserKind(): string {
  return BACKGROUND_BROWSER_KIND;
}

export function hasProxyServer(): boolean {
  return Boolean(currentProxyServer());
}

export async function warnIfBackgroundBrowserMissing(): Promise<void> {
  const executablePath = chromium.executablePath();
  try {
    await access(executablePath, constants.X_OK);
    console.log(`[browser-runtime] Background ${BACKGROUND_BROWSER_KIND} ready: ${executablePath}`);
  } catch {
    console.warn(
      `[browser-runtime] Background ${BACKGROUND_BROWSER_KIND} executable is missing at ${executablePath}. ` +
        `Run '${BACKGROUND_BROWSER_INSTALL_COMMAND}' before using browser-based extraction or keep-alive flows.`,
    );
  }
}

export async function launchBackgroundBrowser(overrides: LaunchOptions = {}): Promise<Browser> {
  const proxyServer = currentProxyServer();
  const launchOptions: LaunchOptions = {
    ...overrides,
    headless: overrides.headless ?? true,
    args: mergeArgs(AUTOMATION_ARGS, overrides.args),
  };

  if (proxyServer && !launchOptions.proxy) {
    launchOptions.proxy = { server: proxyServer };
  }

  return launchBrowser(launchOptions, BACKGROUND_BROWSER_KIND);
}

export async function launchInteractiveChrome(overrides: LaunchOptions = {}): Promise<Browser> {
  const proxyServer = currentProxyServer();
  const launchOptions: LaunchOptions = {
    ...overrides,
    headless: overrides.headless ?? false,
    channel: overrides.channel ?? INTERACTIVE_BROWSER_KIND,
  };

  if (proxyServer && !launchOptions.proxy) {
    launchOptions.proxy = { server: proxyServer };
  }

  return launchBrowser(launchOptions, INTERACTIVE_BROWSER_KIND);
}
