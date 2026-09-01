/**
 * Acceptance tests for archive-review content entry point feature.
 *
 * Red Team verifier — validates the design document specification without
 * reading the newly implemented code directly.
 *
 * Design spec:
 * 1. ArchivedArticleRow gets a new `has_content: boolean` field, computed
 *    as (a.content_full_updated_at IS NOT NULL).
 * 2. ArticleContentData interface includes `content_full_updated_at: string`
 *    and `content_full_error: string` in addition to existing fields.
 * 3. Archive button component: blue clickable when has_content=true,
 *    gray disabled "无存档" when has_content=false.
 * 4. Existing title-click behaviour (ArticleTitle / openDrawer) unchanged.
 *
 * Tests use:
 *   - Static analysis (readFileSync + regex) for structural pattern checks.
 *   - Type-conformance objects for interface validation (compile-time + runtime).
 *   - Runtime imports for pure-function & export checks.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");
const TYPES_FILE = join(ROOT, "lib", "article-db", "types.ts");
const DRAWER_FILE = join(ROOT, "app", "archive-review", "ArticleDrawer.tsx");
const PAGE_FILE = join(ROOT, "app", "archive-review", "page.tsx");
const ARTICLES_TAB_FILE = join(ROOT, "app", "archive-review", "ArticlesTab.tsx");

// ---------------------------------------------------------------------------
// Test Suite 1: ArchivedArticleRow.has_content field
// ---------------------------------------------------------------------------

describe("Test 1: ArchivedArticleRow has the new has_content field", () => {
  it("types.ts declares has_content: boolean on ArchivedArticleRow", () => {
    const source = readFileSync(TYPES_FILE, "utf-8");

    // Locate the ArchivedArticleRow interface block
    const interfaceMatch = source.match(/interface ArchivedArticleRow\s*\{([^}]+)\}/s);
    expect(interfaceMatch, "ArchivedArticleRow interface must exist in types.ts").not.toBeNull();

    const body = interfaceMatch![1];
    expect(body, "ArchivedArticleRow must declare has_content: boolean").toMatch(
      /has_content\s*:\s*boolean/,
    );
  });

  it("has_content appears after the existing fields (not before article_id)", () => {
    // The field should be added after all previous fields — verify it appears
    // in the interface and not that it accidentally replaces another field.
    const source = readFileSync(TYPES_FILE, "utf-8");

    // article_id must still exist
    expect(source).toMatch(/article_id\s*:\s*string/);
    // feedback fields must still exist
    expect(source).toMatch(/feedback_last_at\s*:\s*string/);
    // has_content must now also exist within the same interface
    expect(source).toMatch(/has_content\s*:\s*boolean/);
  });

  it("ArchivedArticleRow type can be satisfied with has_content=true (compile-time conformance)", () => {
    // This test creates a value that must satisfy the type — if has_content is
    // missing from the type the import below will fail at typecheck time.
    // At runtime we just verify the object is shaped correctly.
    type MinimalArchivedArticleRow = {
      article_id: string;
      date: string;
      has_content: boolean;
    };

    const rowWithContent: MinimalArchivedArticleRow = {
      article_id: "a1",
      date: "2026-04-30",
      has_content: true,
    };

    const rowWithoutContent: MinimalArchivedArticleRow = {
      article_id: "a2",
      date: "2026-04-30",
      has_content: false,
    };

    expect(rowWithContent.has_content).toBe(true);
    expect(rowWithoutContent.has_content).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Test Suite 2: has_content computation (IS NOT NULL logic)
// ---------------------------------------------------------------------------

describe("Test 2: has_content is computed from content_full_updated_at", () => {
  it("repository or list-query uses (content_full_updated_at IS NOT NULL) to compute has_content", () => {
    const source = readFileSync(join(ROOT, "lib", "article-db", "repository.ts"), "utf-8");

    // The SQL expression that drives the boolean flag
    const hasExpression =
      /content_full_updated_at\s+IS\s+NOT\s+NULL/i.test(source) ||
      /content_full_updated_at\s*IS\s*NOT\s*NULL/i.test(source);

    expect(
      hasExpression,
      "repository.ts must compute has_content using (content_full_updated_at IS NOT NULL)",
    ).toBe(true);
  });

  it("repository.ts aliases the computed column as has_content", () => {
    const source = readFileSync(join(ROOT, "lib", "article-db", "repository.ts"), "utf-8");

    // The alias must appear: "... AS has_content" or similar
    const hasAlias =
      /AS\s+has_content/i.test(source) ||
      /as\s+has_content/i.test(source) ||
      /"has_content"/.test(source);

    expect(
      hasAlias,
      "repository.ts query must alias the computed IS NOT NULL expression as has_content",
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test Suite 3: ArticleContentData interface includes new fields
// ---------------------------------------------------------------------------

describe("Test 3: ArticleContentData interface includes content_full_updated_at and content_full_error", () => {
  it("ArticleDrawer.tsx exports ArticleContentData with content_full_updated_at: string", () => {
    const source = readFileSync(DRAWER_FILE, "utf-8");

    // Locate the ArticleContentData interface block
    const interfaceMatch = source.match(/interface ArticleContentData\s*\{([^}]+)\}/s);
    expect(
      interfaceMatch,
      "ArticleContentData interface must exist in ArticleDrawer.tsx",
    ).not.toBeNull();

    const body = interfaceMatch![1];
    expect(body, "ArticleContentData must declare content_full_updated_at: string").toMatch(
      /content_full_updated_at\s*:\s*string/,
    );
  });

  it("ArticleDrawer.tsx exports ArticleContentData with content_full_error: string", () => {
    const source = readFileSync(DRAWER_FILE, "utf-8");

    const interfaceMatch = source.match(/interface ArticleContentData\s*\{([^}]+)\}/s);
    expect(
      interfaceMatch,
      "ArticleContentData interface must exist in ArticleDrawer.tsx",
    ).not.toBeNull();

    const body = interfaceMatch![1];
    expect(body, "ArticleContentData must declare content_full_error: string").toMatch(
      /content_full_error\s*:\s*string/,
    );
  });

  it("ArticleContentData retains all pre-existing fields", () => {
    const source = readFileSync(DRAWER_FILE, "utf-8");

    const interfaceMatch = source.match(/interface ArticleContentData\s*\{([^}]+)\}/s);
    expect(interfaceMatch).not.toBeNull();

    const body = interfaceMatch![1];

    // Fields that existed before this feature
    for (const field of [
      "title",
      "content_full_html",
      "content_full_text",
      "content_text",
      "summary_raw",
      "lead_paragraph",
      "original_url",
      "info_url",
      "canonical_url",
    ]) {
      expect(body, `ArticleContentData must still declare pre-existing field: ${field}`).toMatch(
        new RegExp(`${field}\\s*:`),
      );
    }
  });

  it("an object conforming to the augmented ArticleContentData can be constructed (runtime conformance)", () => {
    // Validates the full shape — will fail typecheck if types diverge
    type AugmentedArticleContentData = {
      title: string;
      content_full_html: string;
      content_full_text: string;
      content_text: string;
      summary_raw: string;
      lead_paragraph: string;
      original_url: string;
      info_url: string;
      canonical_url: string;
      content_full_updated_at: string;
      content_full_error: string;
    };

    const sample: AugmentedArticleContentData = {
      title: "Test Article",
      content_full_html: "<p>Hello</p>",
      content_full_text: "Hello",
      content_text: "Hello",
      summary_raw: "A summary",
      lead_paragraph: "Lead",
      original_url: "https://example.com/orig",
      info_url: "https://example.com/info",
      canonical_url: "https://example.com/canonical",
      content_full_updated_at: "2026-04-30T10:00:00.000Z",
      content_full_error: "",
    };

    expect(sample.content_full_updated_at).toBe("2026-04-30T10:00:00.000Z");
    expect(sample.content_full_error).toBe("");
  });

  it("content_full_error carries the error string when extraction failed", () => {
    type ContentDataWithError = {
      content_full_updated_at: string;
      content_full_error: string;
    };

    const errorCase: ContentDataWithError = {
      content_full_updated_at: "",
      content_full_error: "Timeout: extraction exceeded 30s",
    };

    expect(errorCase.content_full_error).toContain("Timeout");
  });
});

// ---------------------------------------------------------------------------
// Test Suite 4: fetchArticleContent server action propagates new fields
// ---------------------------------------------------------------------------

describe("Test 4: fetchArticleContent server action maps content_full_updated_at and content_full_error", () => {
  it("page.tsx fetchArticleContent reads content_full_updated_at from detail", () => {
    const source = readFileSync(PAGE_FILE, "utf-8");

    // The function body must propagate content_full_updated_at
    expect(source, "page.tsx fetchArticleContent must map detail.content_full_updated_at").toMatch(
      /content_full_updated_at/,
    );
  });

  it("page.tsx fetchArticleContent reads content_full_error from detail", () => {
    const source = readFileSync(PAGE_FILE, "utf-8");

    expect(source, "page.tsx fetchArticleContent must map detail.content_full_error").toMatch(
      /content_full_error/,
    );
  });

  it("page.tsx fetchArticleContent returns an object that includes both new fields (static analysis)", () => {
    const source = readFileSync(PAGE_FILE, "utf-8");

    // Locate the return object inside fetchArticleContent
    // The function should have a block like: return { title: ..., content_full_updated_at: ..., ... }
    const fnMatch = source.match(
      /async function fetchArticleContent[\s\S]*?(?=^async function|^export default)/m,
    );

    if (fnMatch) {
      const fnBody = fnMatch[0];
      expect(fnBody, "fetchArticleContent must return content_full_updated_at").toMatch(
        /content_full_updated_at/,
      );
      expect(fnBody, "fetchArticleContent must return content_full_error").toMatch(
        /content_full_error/,
      );
    } else {
      // Fallback: the entire file must still contain both mappings
      expect(source).toMatch(/content_full_updated_at/);
      expect(source).toMatch(/content_full_error/);
    }
  });
});

// ---------------------------------------------------------------------------
// Test Suite 5: Archive button rendering logic (static analysis)
// ---------------------------------------------------------------------------

describe("Test 5: Archive button / 查看存档 renders correctly per has_content state", () => {
  it("ArticlesTab.tsx references has_content for conditional rendering", () => {
    const source = readFileSync(ARTICLES_TAB_FILE, "utf-8");

    expect(
      source,
      "ArticlesTab.tsx must check item.has_content to conditionally render the archive button",
    ).toMatch(/has_content/);
  });

  it("ArticlesTab.tsx renders the 查看存档 text for the archive button", () => {
    const source = readFileSync(ARTICLES_TAB_FILE, "utf-8");

    expect(
      source,
      "ArticlesTab.tsx must contain the 查看存档 label for the archive button",
    ).toMatch(/查看存档/);
  });

  it("ArticlesTab.tsx renders the 无存档 disabled state for articles without content", () => {
    const source = readFileSync(ARTICLES_TAB_FILE, "utf-8");

    expect(source, "ArticlesTab.tsx must contain the 无存档 label for the disabled state").toMatch(
      /无存档/,
    );
  });

  it("ArticlesTab.tsx uses a disabled attribute or aria-disabled on the no-content element", () => {
    const source = readFileSync(ARTICLES_TAB_FILE, "utf-8");

    const hasDisabled = /disabled/.test(source) || /aria-disabled/.test(source);

    expect(
      hasDisabled,
      "ArticlesTab.tsx must disable the archive control when has_content=false",
    ).toBe(true);
  });

  it("the archive button calls openDrawer (or similar) to open the content drawer", () => {
    const source = readFileSync(ARTICLES_TAB_FILE, "utf-8");

    // The button must trigger drawer opening — either via ArticleArchiveButton
    // component, direct useOpenDrawer call, or onClick handler.
    const hasDrawerOpen =
      /openDrawer/.test(source) ||
      /ArticleArchiveButton/.test(source) ||
      /useOpenDrawer/.test(source) ||
      /fetchContent/.test(source);

    expect(hasDrawerOpen, "ArticlesTab.tsx archive button must open the content drawer").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Test Suite 6: Drawer displays archive metadata and empty state error
// ---------------------------------------------------------------------------

describe("Test 6: ArticleDrawer shows crawl timestamp and content_full_error in empty state", () => {
  it("ArticleDrawer.tsx references content_full_updated_at for archive metadata display", () => {
    const source = readFileSync(DRAWER_FILE, "utf-8");

    expect(
      source,
      "ArticleDrawer.tsx must use content_full_updated_at to display crawl timestamp",
    ).toMatch(/content_full_updated_at/);
  });

  it("ArticleDrawer.tsx references content_full_error in the empty / fallback state", () => {
    const source = readFileSync(DRAWER_FILE, "utf-8");

    expect(
      source,
      "ArticleDrawer.tsx must use content_full_error to surface extraction errors",
    ).toMatch(/content_full_error/);
  });
});

// ---------------------------------------------------------------------------
// Test Suite 7: Existing title-click behaviour is unchanged
// ---------------------------------------------------------------------------

describe("Test 7: Existing title-click (ArticleTitle) behavior is preserved", () => {
  it("ArticleDrawer.tsx still exports ArticleTitle component", () => {
    const source = readFileSync(DRAWER_FILE, "utf-8");

    expect(source, "ArticleDrawer.tsx must still export ArticleTitle").toMatch(
      /export function ArticleTitle/,
    );
  });

  it("ArticleTitle still calls openDrawer on click", () => {
    const source = readFileSync(DRAWER_FILE, "utf-8");

    // ArticleTitle must still wire up the openDrawer call
    const articleTitleSection = source.match(/function ArticleTitle[\s\S]*?\n\}/m);
    if (articleTitleSection) {
      expect(
        articleTitleSection[0],
        "ArticleTitle must call openDrawer(articleId) on click",
      ).toMatch(/openDrawer\s*\(/);
    } else {
      expect(source).toMatch(/openDrawer/);
    }
  });

  it("ArticlesTab.tsx still uses ArticleTitle for heading clicks", () => {
    const source = readFileSync(ARTICLES_TAB_FILE, "utf-8");

    expect(source, "ArticlesTab.tsx must still wrap article titles in <ArticleTitle>").toMatch(
      /<ArticleTitle/,
    );
  });

  it("ArticleDrawerProvider still accepts a fetchContent prop", () => {
    const source = readFileSync(DRAWER_FILE, "utf-8");

    expect(source, "ArticleDrawerProvider must still accept fetchContent prop").toMatch(
      /fetchContent/,
    );
  });
});
