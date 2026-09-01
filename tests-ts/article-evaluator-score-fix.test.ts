import { describe, expect, it } from "vitest";
import { ArticleEvaluator, coerceScore } from "@/lib/llm/article-evaluator";

describe("coerceScore boundary values", () => {
  it("treats 10 as 10 (not multiplied to 100)", () => {
    expect(coerceScore(10)).toBe(10);
  });

  it("converts 0-1 normalized scale: 0.85 → 85", () => {
    expect(coerceScore(0.85)).toBe(85);
  });

  it("passes through 75 unchanged", () => {
    expect(coerceScore(75)).toBe(75);
  });

  it("passes through 100 unchanged", () => {
    expect(coerceScore(100)).toBe(100);
  });

  it("returns 0 for input 0", () => {
    expect(coerceScore(0)).toBe(0);
  });

  it("treats integer 1 as 100 (1.0 on the 0-1 normalized scale)", () => {
    expect(coerceScore(1)).toBe(100);
  });

  it("clamps values above 100 to 100", () => {
    expect(coerceScore(150)).toBe(100);
  });

  it("clamps negative values to 0", () => {
    expect(coerceScore(-5)).toBe(0);
  });

  it("returns 0 for non-finite values", () => {
    expect(coerceScore(Number.NaN)).toBe(0);
    expect(coerceScore(undefined)).toBe(0);
    expect(coerceScore("abc")).toBe(0);
  });
});

describe("worth ↔ qualityScore cross-validation", () => {
  const evaluator = new ArticleEvaluator({} as any, {} as any, [
    "strategic_analysis",
    "engineering_practice",
    "research_progress",
    "other",
  ]);

  function parse(worth: string, readingRoiScore: number) {
    return (evaluator as any).parseAssessment("test-id", {
      article_id: "test-id",
      worth,
      reading_roi_score: readingRoiScore,
      company_impact: 50,
      team_impact: 50,
      personal_impact: 50,
      execution_clarity: 50,
      novelty: 50,
      clarity_score: 50,
      one_line_summary: "summary",
      reason_short: "reason",
      action_hint: "hint",
      best_for_roles: ["AI 工程师"],
      evidence_signals: ["benchmark"],
      confidence: 0.9,
      primary_type: "strategic_analysis",
      secondary_types: [],
      tag_groups: {},
    });
  }

  it("caps qualityScore to 40 when worth is '跳过' and score is 80", () => {
    const result = parse("跳过", 80);
    expect(result.qualityScore).toBe(40);
  });

  it("does not change qualityScore when worth is '跳过' and score is already ≤ 40", () => {
    const result = parse("跳过", 30);
    expect(result.qualityScore).toBe(30);
  });

  it("raises qualityScore to 60 when worth is '必读' and score is 40", () => {
    const result = parse("必读", 40);
    expect(result.qualityScore).toBe(60);
  });

  it("does not change qualityScore when worth is '必读' and score is already ≥ 60", () => {
    const result = parse("必读", 75);
    expect(result.qualityScore).toBe(75);
  });

  it("does not modify qualityScore for worth '可读'", () => {
    const result = parse("可读", 55);
    expect(result.qualityScore).toBe(55);
  });
});
