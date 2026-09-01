import { createRemoteJWKSet, jwtVerify } from "jose";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  authenticateAccessToken,
  authenticateArticleDbRequest,
  requireArticleDbAuth,
} from "@/lib/article-db/auth";

vi.mock("jose", () => {
  return {
    createRemoteJWKSet: vi.fn(() => vi.fn()),
    jwtVerify: vi.fn(),
  };
});

function clearAuthEnv(): void {
  delete process.env.AUTH_ISSUER;
  delete process.env.AUTH_AUDIENCE;
  delete process.env.AUTH_JWKS_URL;
  delete process.env.ARTICLE_DB_API_TOKEN;
}

describe("article-db auth", () => {
  afterEach(() => {
    vi.clearAllMocks();
    clearAuthEnv();
  });

  it("allows requests when auth is fully unconfigured", async () => {
    const result = await authenticateArticleDbRequest(
      new Request("https://example.com/api/v1/articles/high-quality"),
    );

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("none");
  });

  it("accepts legacy bearer token", async () => {
    process.env.ARTICLE_DB_API_TOKEN = "legacy-token";

    const result = await authenticateArticleDbRequest(
      new Request("https://example.com/api/v1/articles/high-quality", {
        headers: {
          Authorization: "Bearer legacy-token",
        },
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("legacy_token");
  });

  it("verifies jwt for any valid user", async () => {
    process.env.AUTH_ISSUER = "https://user.stringzhao.life";
    process.env.AUTH_AUDIENCE = "base-account-client";
    process.env.AUTH_JWKS_URL = "https://user.stringzhao.life/.well-known/jwks.json";

    vi.mocked(jwtVerify).mockResolvedValue({
      payload: {
        sub: "usr_daniel",
        email: "daniel@example.com",
      },
      protectedHeader: {
        alg: "RS256",
      },
    } as never);

    const result = await authenticateArticleDbRequest(
      new Request("https://example.com/api/v1/articles/high-quality", {
        headers: {
          Authorization: "Bearer jwt-token",
        },
      }),
    );

    expect(result.ok).toBe(true);
    expect(result.mode).toBe("jwt");
    expect(createRemoteJWKSet).toHaveBeenCalledTimes(1);
  });

  it("returns missing_access_token when auth is configured", async () => {
    process.env.AUTH_ISSUER = "https://user.stringzhao.life";
    process.env.AUTH_AUDIENCE = "base-account-client";
    process.env.AUTH_JWKS_URL = "https://user.stringzhao.life/.well-known/jwks.json";

    const unauthorized = await requireArticleDbAuth(
      new Request("https://example.com/api/v1/articles/high-quality"),
    );
    expect(unauthorized?.status).toBe(401);
    expect(unauthorized?.error).toBe("missing_access_token");
  });

  it("authenticateAccessToken requires verifier config", async () => {
    const result = await authenticateAccessToken("jwt-token");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("invalid_access_token");
    }
  });
});
