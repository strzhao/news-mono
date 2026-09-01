import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";

export async function GET(_request: Request): Promise<Response> {
  return jsonResponse(
    410,
    {
      ok: false,
      error: "deprecated_auth_endpoint",
      message: "use_unified_authorize_flow",
    },
    true,
  );
}
