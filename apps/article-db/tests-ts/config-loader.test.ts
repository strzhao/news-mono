import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadSources } from "@/lib/config-loader";

describe("config-loader source url templates", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "sources-"));
    delete process.env.WEEWE_RSS_TEST_BASE;
    delete process.env.RSSHUB_BASE_URL;
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    delete process.env.WEEWE_RSS_TEST_BASE;
    delete process.env.RSSHUB_BASE_URL;
  });

  function writeSources(yaml: string): string {
    const configPath = join(dir, "sources.yaml");
    writeFileSync(configPath, yaml, "utf-8");
    return configPath;
  }

  it("resolves ${VAR} in url when env is set", () => {
    process.env.WEEWE_RSS_TEST_BASE = "http://10.0.0.1:4000";
    const configPath = writeSources(`
sources:
  - id: templated
    name: Templated
    url: "\${WEEWE_RSS_TEST_BASE}/feeds/x.atom"
`);
    const sources = loadSources(configPath);
    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBe("http://10.0.0.1:4000/feeds/x.atom");
  });

  it("skips entries whose template var is missing but keeps plain urls", () => {
    const configPath = writeSources(`
sources:
  - id: templated
    name: Templated
    url: "\${WEEWE_RSS_TEST_BASE}/feeds/x.atom"
  - id: plain
    name: Plain
    url: "https://example.com/feed"
`);
    const sources = loadSources(configPath);
    expect(sources.map((source) => source.id)).toEqual(["plain"]);
  });

  it("keeps rsshub_route behavior", () => {
    process.env.RSSHUB_BASE_URL = "https://rsshub.example.com";
    const configPath = writeSources(`
sources:
  - id: rsshub
    name: RSSHub
    rsshub_route: /anthropic/news
`);
    const sources = loadSources(configPath);
    expect(sources).toHaveLength(1);
    expect(sources[0].url).toBe("https://rsshub.example.com/anthropic/news");
  });

  it("skips rsshub entries when RSSHUB_BASE_URL is missing", () => {
    const configPath = writeSources(`
sources:
  - id: rsshub
    name: RSSHub
    rsshub_route: /anthropic/news
`);
    const sources = loadSources(configPath);
    expect(sources).toHaveLength(0);
  });
});
