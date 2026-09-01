import { requireArticleDbAuth } from "@/lib/article-db/auth";
import { listTagGroups } from "@/lib/article-db/repository";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";
export const maxDuration = 300;
export const preferredRegion = ["sin1"];

export async function GET(request: Request): Promise<Response> {
  const unauthorized = await requireArticleDbAuth(request);
  if (unauthorized) {
    return jsonResponse(unauthorized.status, { ok: false, error: unauthorized.error, auth_mode: unauthorized.mode }, true);
  }

  try {
    const groups = await listTagGroups();
    return jsonResponse(
      200,
      {
        ok: true,
        generated_at: new Date().toISOString(),
        group_count: groups.length,
        groups,
      },
      true,
    );
  } catch (error) {
    return jsonResponse(500, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}
