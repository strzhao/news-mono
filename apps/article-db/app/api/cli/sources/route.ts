import { requireArticleDbAuth } from "@/lib/article-db/auth";
import { loadSources } from "@/lib/config-loader";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireArticleDbAuth(request);
  if (unauthorized) {
    return jsonResponse(unauthorized.status, { ok: false, error: unauthorized.error }, true);
  }

  try {
    const sources = loadSources();
    const sanitized = sources.map((s) => ({
      id: s.id,
      name: s.name,
      source_type: s.sourceType,
      source_weight: s.sourceWeight,
      only_external_links: s.onlyExternalLinks,
    }));

    return jsonResponse(200, { ok: true, count: sanitized.length, sources: sanitized } as unknown as Record<string, unknown>, true);
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}
