/**
 * Acceptance tests for score normalization requirements.
 *
 * Red Team verifier — validates design requirements WITHOUT reading implementation
 * details of the fix. These tests are written to FAIL against the current buggy
 * implementation and PASS once the fix is applied.
 *
 * Design requirements being verified:
 *
 * Req 1: coerceScore in article-evaluator must:
 *   - Return 0 for non-finite inputs (NaN, Infinity, undefined, null, "abc")
 *   - Only multiply by 100 if value is in range (0, 1] (0-1 normalized scale)
 *   - NOT multiply values > 1 (e.g., 10 stays as 10, NOT 100 — this was the bug)
 *   - Clamp final result to [0, 100]
 *
 * Req 2: parseAssessment worth ↔ qualityScore cross-validation:
 *   - worth=跳过 AND qualityScore > 40 → cap qualityScore to 40
 *   - worth=必读 AND qualityScore < 60 → raise qualityScore to 60
 *   - worth=可读 → no adjustment
 *
 * Req 3: Cache layer coerceScore must NOT re-multiply already-normalized scores.
 *   Stored values are always in [0, 100], so the cache layer must only clamp,
 *   not apply the 0-1 → *100 multiplication.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ArticleEvalCache } from "@/lib/cache/article-eval-cache";
import { ArticleEvaluator } from "@/lib/llm/article-evaluator";

const ROOT = join(__dirname, "..");
const EVALUATOR_FILE = join(ROOT, "lib", "llm", "article-evaluator.ts");
const CACHE_FILE = join(ROOT, "lib", "cache", "article-eval-cache.ts");

// ---------------------------------------------------------------------------
// Helpers: Access private parseAssessment via casting (same pattern used in
// article-evaluator-normalization.test.ts)
// ---------------------------------------------------------------------------

function makeEvaluator(): ArticleEvaluator {
  return new ArticleEvaluator({} as any, {} as any, [
    "strategic_analysis",
    "engineering_practice",
    "research_progress",
    "open_source_project",
    "other",
  ]);
}

function parseAssessment(
  evaluator: ArticleEvaluator,
  articleId: string,
  row: Record<string, unknown>,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (evaluator as any).parseAssessment(articleId, row);
}

/** Minimal valid row so parseAssessment does not throw on unrelated fields. */
function baseRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    article_id: "test-id",
    worth: "可读",
    reading_roi_score: 60,
    company_impact: 60,
    team_impact: 60,
    personal_impact: 60,
    execution_clarity: 60,
    novelty: 60,
    clarity_score: 60,
    one_line_summary: "A concise summary",
    reason_short: "A short reason",
    action_hint: "Do something",
    best_for_roles: ["engineer"],
    evidence_signals: ["benchmark"],
    confidence: 0.85,
    primary_type: "engineering_practice",
    secondary_types: [],
    tag_groups: { topic: ["ai"] },
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Req 1: coerceScore — score normalization logic
// ---------------------------------------------------------------------------

describe("Req 1: coerceScore — score normalization (via parseAssessment reading_roi_score)", () => {
  const evaluator = makeEvaluator();

  /**
   * Helper: pass a raw score value through coerceScore indirectly by setting
   * reading_roi_score in the row and reading back qualityScore from the
   * returned assessment.
   */
  function coerce(value: unknown): number {
    const result = parseAssessment(evaluator, "id", baseRow({ reading_roi_score: value }));
    return result.qualityScore;
  }

  // -------------------------------------------------------------------
  // The key bug fix: score=10 must stay 10, NOT become 100
  // -------------------------------------------------------------------
  it("coerceScore(10) === 10 — a score of 10 on the 0-100 scale must NOT be multiplied to 100", () => {
    expect(coerce(10)).toBe(10);
  });

  it("coerceScore(75) === 75 — mid-range 0-100 score is returned as-is", () => {
    expect(coerce(75)).toBe(75);
  });

  it("coerceScore(100) === 100 — maximum 0-100 score is returned as-is", () => {
    expect(coerce(100)).toBe(100);
  });

  // -------------------------------------------------------------------
  // 0-1 normalized scale → multiply by 100
  // -------------------------------------------------------------------
  it("coerceScore(0.85) === 85 — fractional value in (0, 1] is scaled to 0-100", () => {
    expect(coerce(0.85)).toBe(85);
  });

  it("coerceScore(0.5) === 50 — fractional value 0.5 is scaled to 50", () => {
    expect(coerce(0.5)).toBe(50);
  });

  it("coerceScore(1) === 100 — boundary value 1 is treated as 0-1 scale and becomes 100", () => {
    expect(coerce(1)).toBe(100);
  });

  it("coerceScore(1.01) === 1.01 — just above boundary is NOT multiplied", () => {
    expect(coerce(1.01)).toBeCloseTo(1.01, 5);
  });

  // -------------------------------------------------------------------
  // Clamping
  // -------------------------------------------------------------------
  it("coerceScore(150) === 100 — values above 100 are clamped to 100", () => {
    expect(coerce(150)).toBe(100);
  });

  it("coerceScore(0) === 0 — zero remains zero", () => {
    expect(coerce(0)).toBe(0);
  });

  it("coerceScore(-5) === 0 — negative values are clamped to 0", () => {
    expect(coerce(-5)).toBe(0);
  });

  // -------------------------------------------------------------------
  // Non-finite / invalid inputs → 0
  // -------------------------------------------------------------------
  it("coerceScore(NaN) === 0 — NaN maps to 0", () => {
    expect(coerce(Number.NaN)).toBe(0);
  });

  it("coerceScore(Infinity) === 0 — Infinity maps to 0 before clamping step", () => {
    // Infinity is non-finite so it should be reset to 0, NOT clamped to 100
    expect(coerce(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("coerceScore(undefined) === 0 — undefined maps to 0", () => {
    expect(coerce(undefined)).toBe(0);
  });

  it("coerceScore(null) === 0 — null maps to 0", () => {
    expect(coerce(null)).toBe(0);
  });

  it('coerceScore("abc") === 0 — non-numeric string maps to 0', () => {
    expect(coerce("abc")).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Req 2: worth ↔ qualityScore cross-validation in parseAssessment
// ---------------------------------------------------------------------------

describe("Req 2: parseAssessment cross-validates worth ↔ qualityScore", () => {
  const evaluator = makeEvaluator();

  describe("worth=跳过 (skip) with high qualityScore", () => {
    it("caps qualityScore to 40 when worth=跳过 and raw score is 85", () => {
      const result = parseAssessment(
        evaluator,
        "skip-high",
        baseRow({ worth: "跳过", reading_roi_score: 85 }),
      );
      expect(result.worth).toBe("跳过");
      expect(result.qualityScore).toBeLessThanOrEqual(40);
    });

    it("caps qualityScore to 40 when worth=跳过 and raw score is exactly 41", () => {
      const result = parseAssessment(
        evaluator,
        "skip-41",
        baseRow({ worth: "跳过", reading_roi_score: 41 }),
      );
      expect(result.qualityScore).toBeLessThanOrEqual(40);
    });

    it("caps qualityScore to 40 when worth=跳过 and raw score is 100", () => {
      const result = parseAssessment(
        evaluator,
        "skip-100",
        baseRow({ worth: "跳过", reading_roi_score: 100 }),
      );
      expect(result.qualityScore).toBeLessThanOrEqual(40);
    });

    it("does NOT further cap when worth=跳过 and score is already at or below 40", () => {
      const result = parseAssessment(
        evaluator,
        "skip-low",
        baseRow({ worth: "跳过", reading_roi_score: 30 }),
      );
      expect(result.qualityScore).toBe(30);
    });

    it("does NOT cap when worth=跳过 and score is exactly 40 (boundary is included)", () => {
      const result = parseAssessment(
        evaluator,
        "skip-boundary",
        baseRow({ worth: "跳过", reading_roi_score: 40 }),
      );
      expect(result.qualityScore).toBe(40);
    });
  });

  describe("worth=必读 (must-read) with low qualityScore", () => {
    it("raises qualityScore to 60 when worth=必读 and raw score is 20", () => {
      const result = parseAssessment(
        evaluator,
        "must-read-low",
        baseRow({ worth: "必读", reading_roi_score: 20 }),
      );
      expect(result.worth).toBe("必读");
      expect(result.qualityScore).toBeGreaterThanOrEqual(60);
    });

    it("raises qualityScore to 60 when worth=必读 and raw score is 59", () => {
      const result = parseAssessment(
        evaluator,
        "must-read-59",
        baseRow({ worth: "必读", reading_roi_score: 59 }),
      );
      expect(result.qualityScore).toBeGreaterThanOrEqual(60);
    });

    it("does NOT further raise when worth=必读 and score is already at or above 60", () => {
      const result = parseAssessment(
        evaluator,
        "must-read-80",
        baseRow({ worth: "必读", reading_roi_score: 80 }),
      );
      expect(result.qualityScore).toBe(80);
    });

    it("does NOT raise when worth=必读 and score is exactly 60 (boundary is included)", () => {
      const result = parseAssessment(
        evaluator,
        "must-read-boundary",
        baseRow({ worth: "必读", reading_roi_score: 60 }),
      );
      expect(result.qualityScore).toBe(60);
    });
  });

  describe("worth=可读 (worth-reading) — no adjustment", () => {
    it("leaves qualityScore unchanged at 30 when worth=可读", () => {
      const result = parseAssessment(
        evaluator,
        "readable-low",
        baseRow({ worth: "可读", reading_roi_score: 30 }),
      );
      expect(result.worth).toBe("可读");
      expect(result.qualityScore).toBe(30);
    });

    it("leaves qualityScore unchanged at 75 when worth=可读", () => {
      const result = parseAssessment(
        evaluator,
        "readable-high",
        baseRow({ worth: "可读", reading_roi_score: 75 }),
      );
      expect(result.qualityScore).toBe(75);
    });
  });

  it("contradiction is resolved: skip + high score cannot coexist after parsing", () => {
    // The core invariant: if AI says 'skip', qualityScore must be <= 40
    // (prevents the scenario where the article is filtered in as high-quality
    //  even though the AI evaluated it as not worth reading)
    const skip = parseAssessment(
      evaluator,
      "contradiction",
      baseRow({ worth: "跳过", reading_roi_score: 95 }),
    );
    expect(skip.qualityScore).toBeLessThanOrEqual(40);

    // And the reverse: must-read + low score is also resolved
    const mustRead = parseAssessment(
      evaluator,
      "contradiction-2",
      baseRow({ worth: "必读", reading_roi_score: 5 }),
    );
    expect(mustRead.qualityScore).toBeGreaterThanOrEqual(60);
  });
});

// ---------------------------------------------------------------------------
// Req 3: Cache layer score handler must NOT re-multiply already-normalized scores
// ---------------------------------------------------------------------------

describe("Req 3: Cache layer must only clamp scores, not re-multiply 0-1 values", () => {
  /**
   * The implementation may name this function coerceScore or clampScore or
   * any other name — what matters is that the score normalization logic used
   * by the cache does NOT apply the *100 multiplication for 0-1 scale values,
   * since scores stored in the cache are always in [0, 100] already.
   *
   * We search for ANY function in the cache file that handles score clamping
   * by looking for the Math.max(0, Math.min(100, ...)) pattern.
   */

  function findCacheScoreFunction(source: string): string | null {
    // Match any function (named anything) that contains the [0, 100] clamp pattern
    // This accommodates both coerceScore and clampScore naming conventions
    const allFunctions = source.matchAll(/function (\w+)\(value[^)]*\)[\s\S]*?\n {2}\}/gm);
    for (const match of allFunctions) {
      const body = match[0];
      if (/Math\.max.*Math\.min|Math\.min.*Math\.max/.test(body)) {
        return body;
      }
    }
    return null;
  }

  it("cache score normalization function does NOT multiply values in (0, 1] by 100 (static analysis)", () => {
    // The cache stores assessment scores in 0-100 range. When it reads them back,
    // it must NOT apply the 0-1 → *100 multiplication, since the value is already
    // normalized. This requirement is checked via static analysis of the cache file.
    const source = readFileSync(CACHE_FILE, "utf-8");

    // Approach 1: look for a dedicated score normalization function
    const fnBody = findCacheScoreFunction(source);

    if (fnBody) {
      // If such a function exists, it must NOT multiply by 100 for 0-1 range
      const hasMultiplicationBy100 = /\*\s*100/.test(fnBody);
      expect(
        hasMultiplicationBy100,
        "Cache score normalization must NOT multiply by 100 — stored values are already normalized in [0,100]. " +
          "Only a simple Math.max(0, Math.min(100, score)) clamp is needed.",
      ).toBe(false);
    } else {
      // Approach 2: scan the whole file — the bug pattern is "score <= 10" near "*= 10"
      // If the cache file doesn't have a dedicated function, check that the old buggy
      // 0-10 multiplication pattern is not present anywhere in the score handling code
      const hasBuggyPattern = /score\s*<=\s*10[\s\S]{0,30}\*=\s*10/.test(source);
      expect(
        hasBuggyPattern,
        "Cache score normalization must NOT contain the 0-10 scale multiplication pattern",
      ).toBe(false);
    }
  });

  it("cache score normalization clamps to [0, 100] (static analysis)", () => {
    const source = readFileSync(CACHE_FILE, "utf-8");

    // The clamp pattern must appear somewhere in the cache file's score handling
    const hasClamp =
      /Math\.max\s*\(\s*0\s*,\s*Math\.min\s*\(\s*100/.test(source) ||
      /Math\.min\s*\(\s*100[\s\S]{0,10}Math\.max\s*\(\s*0/.test(source);

    expect(hasClamp, "Cache must clamp scores to [0, 100] using Math.max/Math.min").toBe(true);
  });

  it("cache score normalization handles non-finite inputs (static analysis)", () => {
    const source = readFileSync(CACHE_FILE, "utf-8");

    // Must handle non-finite inputs somewhere in score-related code
    const handlesNonFinite = /isFinite/.test(source) || /isNaN/.test(source);

    expect(
      handlesNonFinite,
      "Cache score normalization must guard against non-finite inputs (NaN, Infinity)",
    ).toBe(true);
  });

  it("evaluator coerceScore uses 0-1 boundary detection — not 0-10 range (static analysis)", () => {
    const source = readFileSync(EVALUATOR_FILE, "utf-8");

    // The fixed evaluator coerceScore should check: score > 0 && score <= 1
    // The buggy version checked: score >= 0 && score <= 10
    // We verify the boundary is 1, not 10.
    const fnMatch = source.match(/function coerceScore[\s\S]*?\n\}/m);
    expect(fnMatch, "evaluator file must define a coerceScore function").not.toBeNull();

    const fnBody = fnMatch![0];

    // Should NOT contain the old "score <= 10" boundary for 0-1 detection
    const hasBuggyTenBoundary = /score\s*<=\s*10\b/.test(fnBody);
    expect(
      hasBuggyTenBoundary,
      "Evaluator coerceScore must NOT use score <= 10 as the 0-1 scale boundary. " +
        "This caused coerceScore(10) = 100 instead of 10. Use score <= 1 instead.",
    ).toBe(false);

    // Should contain the correct "score <= 1" boundary
    const hasCorrectOneBoundary =
      /score\s*<=\s*1\b/.test(fnBody) || /score\s*<\s*=\s*1[^0-9]/.test(fnBody);
    expect(
      hasCorrectOneBoundary,
      "Evaluator coerceScore must use score <= 1 as the threshold for 0-1 scale detection",
    ).toBe(true);

    // Should multiply by 100 (not 10) for 0-1 scale values
    const multipliesBy100 = /\*\s*100/.test(fnBody);
    expect(
      multipliesBy100,
      "Evaluator coerceScore must multiply 0-1 values by 100 to convert to 0-100 scale",
    ).toBe(true);
  });
});
