import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/auth/session/finalize/route";
import { AUTH_STATE_COOKIE_NAME, createAuthStateCookieValue } from "@/lib/article-db/auth-gateway-session";
import { jwtVerify } from "jose";

vi.mock("jose", () => {
  return {
    createRemoteJWKSet: vi.fn(() => vi.fn()),
    jwtVerify: vi.fn(),
  };
});

function setAuthEnv(): void {
  process.env.AUTH_ISSUER = "https://user.stringzhao.life";
  process.env.AUTH_AUDIENCE = "base-account-client";
  process.env.AUTH_JWKS_URL = "https://user.stringzhao.life/.well-known/jwks.json";
}

function clearAuthEnv(): void {
  delete process.env.AUTH_ISSUER;
  delete process.env.AUTH_AUDIENCE;
  delete process.env.AUTH_JWKS_URL;
}

describe("auth session finalize route", () => {
  afterEach(() => {
    vi.clearAllMocks();
    clearAuthEnv();
  });

  it("returns 400 when state is invalid", async () => {
    setAuthEnv();

    const response = await POST(
      new Request("https://example.com/api/auth/session/finalize", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          state: "missing",
        }),
      }),
    );

    const payload = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(400);
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe("invalid_state");
  });

  it("writes gateway cookie for valid jwt user", async () => {
    setAuthEnv();
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        sub: "usr_daniel",
        email: "daniel@example.com",
      },
      protectedHeader: {
        alg: "RS256",
      },
    } as never);

    const state = "state-ok";
    const stateCookie = createAuthStateCookieValue(state, "/archive-review?quality_tier=high");

    const response = await POST(
      new Request("https://example.com/api/auth/session/finalize", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${AUTH_STATE_COOKIE_NAME}=${stateCookie}; access_token=jwt-token`,
        },
        body: JSON.stringify({
          state,
        }),
      }),
    );

    const payload = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(payload.next).toBe("/archive-review?quality_tier=high");

    const setCookieHeader = String(response.headers.get("set-cookie") || "");
    expect(setCookieHeader).toContain("article_db_gateway_session=");
    expect(setCookieHeader).toContain("article_db_auth_state=");
  });

  it("accepts any valid jwt user without allowlist", async () => {
    setAuthEnv();
    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        sub: "usr_other",
        email: "other@example.com",
      },
      protectedHeader: {
        alg: "RS256",
      },
    } as never);

    const state = "state-ok";
    const stateCookie = createAuthStateCookieValue(state, "/archive-review");

    const response = await POST(
      new Request("https://example.com/api/auth/session/finalize", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          cookie: `${AUTH_STATE_COOKIE_NAME}=${stateCookie}; access_token=jwt-token`,
        },
        body: JSON.stringify({
          state,
        }),
      }),
    );

    const payload = (await response.json()) as Record<string, unknown>;
    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
  });
});
