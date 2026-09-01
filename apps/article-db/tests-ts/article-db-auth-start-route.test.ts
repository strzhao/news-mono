import { afterEach, describe, expect, it } from "vitest";
import { GET } from "@/app/auth/start/route";

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

describe("auth start route", () => {
  afterEach(() => {
    clearAuthEnv();
  });

  it("redirects to unified authorize and writes state cookie", async () => {
    setAuthEnv();

    const response = await GET(
      new Request("https://article-db.stringzhao.life/auth/start?next=%2Farchive-review%3Fquality_tier%3Dhigh"),
    );

    expect(response.status).toBe(302);
    const location = String(response.headers.get("location") || "");
    expect(location.startsWith("https://user.stringzhao.life/authorize?")).toBe(true);

    const redirectUrl = new URL(location);
    expect(redirectUrl.searchParams.get("service")).toBe("base-account-client");
    expect(redirectUrl.searchParams.get("return_to")).toBe("https://article-db.stringzhao.life/auth/callback");
    expect(String(redirectUrl.searchParams.get("state") || "").length).toBeGreaterThan(10);

    const setCookieHeader = String(response.headers.get("set-cookie") || "");
    expect(setCookieHeader).toContain("article_db_auth_state=");
  });

  it("returns 500 when auth env is not configured", async () => {
    const response = await GET(new Request("https://article-db.stringzhao.life/auth/start"));
    const payload = (await response.json()) as Record<string, unknown>;

    expect(response.status).toBe(500);
    expect(payload.ok).toBe(false);
    expect(payload.error).toBe("auth_not_configured");
  });
});
