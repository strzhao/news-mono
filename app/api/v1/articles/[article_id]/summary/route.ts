import { requireArticleDbAuth } from "@/lib/article-db/auth";
import {
  getArticleSummary,
  getHighQualityArticleDetail,
  tryLockSummaryForGeneration,
  upsertArticleSummary,
} from "@/lib/article-db/repository";
import { jsonResponse } from "@/lib/infra/route-utils";
import { generateArticleSummary } from "@/lib/llm/article-summary-generator";

export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = ["sin1"];

export async function GET(
  request: Request,
  context: { params: Promise<{ article_id: string }> },
): Promise<Response> {
  const unauthorized = await requireArticleDbAuth(request);
  if (unauthorized) {
    return jsonResponse(
      unauthorized.status,
      { ok: false, error: unauthorized.error, auth_mode: unauthorized.mode },
      true,
    );
  }

  const params = await context.params;
  const articleId = String(params.article_id || "").trim();
  if (!articleId) {
    return jsonResponse(400, { ok: false, error: "Missing article_id" }, true);
  }

  try {
    const existing = await getArticleSummary(articleId);

    if (existing && existing.status === "completed") {
      return jsonResponse(
        200,
        {
          ok: true,
          status: "completed",
          summary_markdown: existing.summary_markdown,
          model_name: existing.model_name,
          updated_at: existing.updated_at,
        },
        true,
      );
    }

    if (existing && existing.status === "generating") {
      return jsonResponse(200, { ok: true, status: "generating" }, true);
    }

    // Fetch article detail for content
    const detail = await getHighQualityArticleDetail(articleId);
    if (!detail) {
      return jsonResponse(404, { ok: false, error: "Article not found" }, true);
    }

    // Check if there's enough content to summarize
    const hasContent =
      (detail.content_full_text && detail.content_full_text.length > 50) ||
      (detail.content_text && detail.content_text.length > 50) ||
      (detail.summary_raw && detail.summary_raw.length > 20);

    if (!hasContent) {
      return jsonResponse(200, { ok: true, status: "no_content" }, true);
    }

    // Try to acquire lock
    const locked = await tryLockSummaryForGeneration(articleId);
    if (!locked) {
      return jsonResponse(200, { ok: true, status: "generating" }, true);
    }

    // Generate summary synchronously
    try {
      const result = await generateArticleSummary({
        articleId,
        title: detail.title,
        url: detail.original_url || detail.canonical_url,
        contentFullText: detail.content_full_text,
        contentText: detail.content_text,
        summaryRaw: detail.summary_raw,
        leadParagraph: detail.lead_paragraph,
      });

      await upsertArticleSummary({
        articleId,
        summaryMarkdown: result.markdown,
        modelName: result.modelName,
        promptVersion: result.promptVersion,
        status: "completed",
      });

      return jsonResponse(
        200,
        {
          ok: true,
          status: "completed",
          summary_markdown: result.markdown,
          model_name: result.modelName,
          updated_at: new Date().toISOString(),
        },
        true,
      );
    } catch (genError) {
      const errorMessage = genError instanceof Error ? genError.message : String(genError);
      await upsertArticleSummary({
        articleId,
        summaryMarkdown: "",
        modelName: "",
        promptVersion: "",
        status: "failed",
        errorMessage: errorMessage.slice(0, 2000),
      });

      return jsonResponse(
        200,
        {
          ok: true,
          status: "failed",
          error: errorMessage,
        },
        true,
      );
    }
  } catch (error) {
    return jsonResponse(
      500,
      {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      },
      true,
    );
  }
}
