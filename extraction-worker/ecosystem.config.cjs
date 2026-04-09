// Detect macOS system proxy (ClashX etc.) for Node.js fetch
function detectSystemProxy() {
  try {
    const { execSync } = require("node:child_process");
    const output = execSync("scutil --proxy", { encoding: "utf8", timeout: 3000 });
    const get = (key) => {
      const m = output.match(new RegExp(`${key}\\s*:\\s*(.+)`));
      return m ? m[1].trim() : "";
    };
    if (get("HTTPSEnable") === "1" || get("HTTPEnable") === "1") {
      const host = get("HTTPSProxy") || get("HTTPProxy") || "127.0.0.1";
      const port = get("HTTPSPort") || get("HTTPPort");
      if (port) return `http://${host}:${port}`;
    }
  } catch {}
  return "";
}

const proxyUrl = detectSystemProxy();

module.exports = {
  apps: [
    {
      name: "extraction-worker",
      script: "node_modules/.bin/tsx",
      // PM2 is the single supported owner for long-running polling + browser extraction.
      args: "--env-file=.env src/index.ts --server --poll",
      cwd: "/Users/stringzhao/workspace/agi/live/article-db/extraction-worker",
      interpreter: "none",
      env: {
        NODE_ENV: "production",
        PATH: "/Users/stringzhao/.nvm/versions/node/v22.17.0/bin:/usr/local/bin:/usr/bin:/bin",
        ...(proxyUrl
          ? {
              https_proxy: proxyUrl,
              http_proxy: proxyUrl,
              HTTPS_PROXY: proxyUrl,
              HTTP_PROXY: proxyUrl,
              NO_PROXY: "localhost,127.0.0.1,::1",
            }
          : {}),
      },
      // Restart policy
      autorestart: true,
      max_restarts: 20,
      min_uptime: "10s",
      restart_delay: 5000,
      kill_timeout: 10000,
      // Logs
      log_date_format: "YYYY-MM-DD HH:mm:ss",
      error_file: "logs/error.log",
      out_file: "logs/out.log",
      merge_logs: true,
      max_size: "10M",
      retain: 5,
    },
  ],
};
