import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = path.join(projectRoot, "scripts", "migrate-independent-neon.mjs");

describe("article-db migrate script", () => {
  it("prints help text", () => {
    const output = execFileSync(process.execPath, [scriptPath, "help"], {
      cwd: projectRoot,
      encoding: "utf8",
    });

    expect(output).toContain("db:bootstrap");
    expect(output).toContain("db:clone");
    expect(output).toContain("db:verify");
  });

  it("fails fast without a target URL for bootstrap", () => {
    expect(() =>
      execFileSync(process.execPath, [scriptPath, "bootstrap"], {
        cwd: projectRoot,
        encoding: "utf8",
        env: {
          ...process.env,
          TARGET_DATABASE_URL: "",
        },
        stdio: "pipe",
      }),
    ).toThrow(/Missing target database URL/);
  });
});
