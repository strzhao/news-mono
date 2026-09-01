import { requireArticleDbAuth } from "@/lib/article-db/auth";
import { markFlomoArchivePushBatchFailed } from "@/lib/article-db/repository";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";
export const maxDuration = 120;
export const preferredRegion = ["sin1"];

interface FailedBody {
  error_message?: string;
}

async function parseBody(request: Request): Promise<FailedBody> {
  try {
    const body = (await request.json()) as FailedBody;
    if (!body || typeof body !== "object") {
      return {};
    }
    return body;
  } catch {
    return {};
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ batch_key: string }> },
): Promise<Response> {
  const unauthorized = await requireArticleDbAuth(request);
  if (unauthorized) {
    return jsonResponse(unauthorized.status, { ok: false, error: unauthorized.error, auth_mode: unauthorized.mode }, true);
  }

  const params = await context.params;
  const batchKey = String(params.batch_key || "").trim();
  if (!batchKey) {
    return jsonResponse(400, { ok: false, error: "Missing batch_key" }, true);
  }

  try {
    const body = await parseBody(request);
    await markFlomoArchivePushBatchFailed({
      batchKey,
      errorMessage: String(body.error_message || "").trim() || "Unknown flomo push failure",
    });

    return jsonResponse(
      200,
      {
        ok: true,
        generated_at: new Date().toISOString(),
        batch_key: batchKey,
      },
      true,
    );
  } catch (error) {
    return jsonResponse(400, { ok: false, error: error instanceof Error ? error.message : String(error) }, true);
  }
}
