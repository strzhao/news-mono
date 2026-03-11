import { requireArticleDbAuth } from "@/lib/article-db/auth";
import { buildCliManifest } from "@/lib/cli/manifest";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireArticleDbAuth(request);
  if (unauthorized) {
    return jsonResponse(unauthorized.status, { ok: false, error: unauthorized.error }, true);
  }

  const manifest = buildCliManifest();
  return jsonResponse(200, manifest as unknown as Record<string, unknown>, true);
}
