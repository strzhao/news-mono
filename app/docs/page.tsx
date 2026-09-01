import type { CliCommandDef } from "@/lib/cli/manifest";
import { buildCliManifest } from "@/lib/cli/manifest";
import { CopyButton } from "./CopyButton";
import styles from "./page.module.css";

export const dynamic = "force-static";

function commandPath(cmd: CliCommandDef): string {
  return cmd.path.join(" ");
}

function commandUsage(cmd: CliCommandDef): string {
  let usage = `article-db ${commandPath(cmd)}`;
  if (cmd.arguments) {
    for (const arg of cmd.arguments) {
      usage += arg.required ? ` <${arg.name}>` : ` [${arg.name}]`;
    }
  }
  if (cmd.options?.length) {
    usage += " [options]";
  }
  return usage;
}

function buildPlainTextDocs(manifest: ReturnType<typeof buildCliManifest>): string {
  const lines: string[] = [];
  lines.push("# article-db CLI Documentation");
  lines.push("");
  lines.push(
    "article-db CLI 是 article-db 系统的命令行工具，用于触发爬取、提取内容、查询文章等操作。",
  );
  lines.push("");
  lines.push("## 安装");
  lines.push("npm install -g @stringzhao/article-db-cli");
  lines.push("");
  lines.push("## 认证");
  lines.push("# 浏览器登录（推荐）");
  lines.push("article-db login");
  lines.push("");
  lines.push("# 或使用 API Key");
  lines.push("export ARTICLE_DB_CLI_API_KEY=your_api_key");
  lines.push("");
  lines.push("## 命令参考");
  lines.push("");

  for (const cmd of manifest.commands) {
    lines.push(`### ${commandPath(cmd)}`);
    lines.push(cmd.description);
    lines.push(`用法: ${commandUsage(cmd)}`);
    if (cmd.arguments?.length) {
      lines.push("参数:");
      for (const arg of cmd.arguments) {
        lines.push(`  ${arg.name} - ${arg.description}${arg.required ? " (必填)" : ""}`);
      }
    }
    if (cmd.options?.length) {
      lines.push("选项:");
      for (const opt of cmd.options) {
        const flag = opt.short ? `-${opt.short}, --${opt.name}` : `--${opt.name}`;
        lines.push(`  ${flag} - ${opt.description}${opt.required ? " (必填)" : ""}`);
      }
    }
    lines.push("");
  }

  return lines.join("\n");
}

export default function DocsPage() {
  const manifest = buildCliManifest();
  const plainText = buildPlainTextDocs(manifest);

  return (
    <div className={styles.page}>
      <nav className={styles.nav}>
        <a href="/" className={styles.brand}>
          article-db
        </a>
        <div className={styles.navLinks}>
          <CopyButton content={plainText} />
        </div>
      </nav>

      <main className={styles.main}>
        <section className={styles.hero}>
          <h1 className={styles.title}>article-db CLI</h1>
          <p className={styles.subtitle}>
            命令行工具，用于触发爬取、提取内容、查询文章等操作。面向开发者和 AI Agent。
          </p>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>安装</h2>
          <pre className={styles.codeBlock}>npm install -g @stringzhao/article-db-cli</pre>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>认证</h2>
          <pre className={styles.codeBlock}>{`# 浏览器登录（推荐）
article-db login

# 或使用 API Key
export ARTICLE_DB_CLI_API_KEY=your_api_key`}</pre>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>命令参考</h2>
          <p className={styles.versionTag}>
            manifest v{manifest.version} · {manifest.commands.length} 个命令
          </p>

          <div className={styles.commandList}>
            {manifest.commands.map((cmd) => (
              <div key={commandPath(cmd)} className={styles.commandCard}>
                <div className={styles.commandHeader}>
                  <code className={styles.commandName}>{commandPath(cmd)}</code>
                  <span className={styles.commandMethod}>{cmd.api.method}</span>
                </div>
                <p className={styles.commandDesc}>{cmd.description}</p>
                <pre className={styles.commandUsage}>{commandUsage(cmd)}</pre>

                {cmd.arguments && cmd.arguments.length > 0 && (
                  <div className={styles.paramGroup}>
                    <span className={styles.paramLabel}>参数</span>
                    {cmd.arguments.map((arg) => (
                      <div key={arg.name} className={styles.paramRow}>
                        <code className={styles.paramName}>{arg.name}</code>
                        <span className={styles.paramDesc}>{arg.description}</span>
                        {arg.required && <span className={styles.paramRequired}>必填</span>}
                      </div>
                    ))}
                  </div>
                )}

                {cmd.options && cmd.options.length > 0 && (
                  <div className={styles.paramGroup}>
                    <span className={styles.paramLabel}>选项</span>
                    {cmd.options.map((opt) => (
                      <div key={opt.name} className={styles.paramRow}>
                        <code className={styles.paramName}>
                          {opt.short ? `-${opt.short}, ` : ""}--{opt.name}
                        </code>
                        <span className={styles.paramDesc}>{opt.description}</span>
                        {opt.required && <span className={styles.paramRequired}>必填</span>}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}
