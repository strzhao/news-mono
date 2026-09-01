import { NextResponse } from "next/server";
import {
  clearAuthStateCookie,
  clearGatewaySessionCookie,
} from "@/lib/article-db/auth-gateway-session";

export const runtime = "nodejs";

export async function POST(): Promise<Response> {
  const response = NextResponse.json(
    {
      ok: true,
      success: true,
    },
    { status: 200 },
  );
  response.headers.set("Cache-Control", "no-store, max-age=0");
  clearAuthStateCookie(response);
  clearGatewaySessionCookie(response);
  return response;
}
