import { NextResponse } from "next/server";
import { authenticateAccessToken } from "@/lib/article-db/auth";
import {
  applyGatewaySessionCookie,
  clearAuthStateCookie,
  createGatewaySessionCookieValue,
  readAuthStateCookie,
  verifyAuthStateCookieValue,
} from "@/lib/article-db/auth-gateway-session";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";

interface FinalizeBody {
  state?: string;
}

async function parseBody(request: Request): Promise<FinalizeBody> {
  try {
    const payload = (await request.json()) as FinalizeBody;
    if (!payload || typeof payload !== "object") {
      return {};
    }
    return payload;
  } catch {
    return {};
  }
}

function noStore(response: NextResponse): NextResponse {
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

export async function POST(request: Request): Promise<Response> {
  const body = await parseBody(request);
  const state = String(body.state || "").trim();
  if (!state) {
    return jsonResponse(400, { ok: false, error: "invalid_input" }, true);
  }

  const authStateCookie = readAuthStateCookie(request);
  const authState = verifyAuthStateCookieValue(authStateCookie, state);
  if (!authState) {
    const response = NextResponse.json({ ok: false, error: "invalid_state" }, { status: 400 });
    clearAuthStateCookie(response);
    return noStore(response);
  }

  const accessToken = readCookie(request, "access_token");
  if (!accessToken) {
    return jsonResponse(
      401,
      {
        ok: false,
        error: "missing_access_token",
        message: "missing_access_token_cookie",
      },
      true,
    );
  }

  const authResult = await authenticateAccessToken(accessToken);
  if (!authResult.ok) {
    return jsonResponse(
      authResult.status,
      {
        ok: false,
        error: authResult.error,
        message: authResult.message,
      },
      true,
    );
  }

  if (!authResult.user) {
    return jsonResponse(401, { ok: false, error: "invalid_access_token" }, true);
  }

  const response = NextResponse.json(
    {
      ok: true,
      next: authState.next,
      user: {
        id: authResult.user.id,
        email: authResult.user.email,
        status: authResult.user.status,
      },
    },
    { status: 200 },
  );
  clearAuthStateCookie(response);
  applyGatewaySessionCookie(
    response,
    createGatewaySessionCookieValue(authResult.user.id, authResult.user.email),
  );
  return noStore(response);
}

function readCookie(request: Request, name: string): string {
  const raw = String(request.headers.get("cookie") || "").trim();
  if (!raw) {
    return "";
  }

  for (const chunk of raw.split(";")) {
    const [cookieName, ...valueParts] = chunk.split("=");
    if (String(cookieName || "").trim() !== name) {
      continue;
    }

    const value = valueParts.join("=").trim();
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return "";
}
