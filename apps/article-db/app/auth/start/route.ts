import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { authBridgeEnabled, authIssuer } from "@/lib/article-db/auth";
import {
  applyAuthStateCookie,
  createAuthStateCookieValue,
  normalizeNextPath,
} from "@/lib/article-db/auth-gateway-session";
import { jsonResponse } from "@/lib/infra/route-utils";

export const runtime = "nodejs";

function authAudience(): string {
  return String(process.env.AUTH_AUDIENCE || "").trim();
}

export async function GET(request: Request): Promise<Response> {
  if (!authBridgeEnabled()) {
    return jsonResponse(500, { ok: false, error: "auth_not_configured" }, true);
  }

  const issuer = authIssuer().replace(/\/$/, "");
  const audience = authAudience();
  if (!issuer || !audience) {
    return jsonResponse(500, { ok: false, error: "auth_not_configured" }, true);
  }

  const requestUrl = new URL(request.url);
  const nextPath = normalizeNextPath(requestUrl.searchParams.get("next") || "");
  const state = randomUUID();
  const callbackUrl = new URL("/auth/callback", request.url).toString();
  const authorizeUrl = new URL("/authorize", `${issuer}/`);

  authorizeUrl.searchParams.set("service", audience);
  authorizeUrl.searchParams.set("return_to", callbackUrl);
  authorizeUrl.searchParams.set("state", state);

  const response = NextResponse.redirect(authorizeUrl, { status: 302 });
  response.headers.set("Cache-Control", "no-store, max-age=0");
  applyAuthStateCookie(response, createAuthStateCookieValue(state, nextPath));
  return response;
}
