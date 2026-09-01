import type { JWTPayload } from "jose";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { parseBearerToken } from "@/lib/domain/tracker-common";

export const ACCESS_TOKEN_COOKIE_NAME = "article_db_access_token";
export const REFRESH_TOKEN_COOKIE_NAME = "article_db_refresh_token";

export type ArticleDbAuthMode = "jwt" | "legacy_token" | "none";

export interface ArticleDbAuthUser {
  id: string;
  email: string;
  status: string;
  claims: Record<string, unknown>;
}

export interface ArticleDbAuthSuccess {
  ok: true;
  mode: ArticleDbAuthMode;
  user: ArticleDbAuthUser | null;
}

export interface ArticleDbAuthFailure {
  ok: false;
  status: 401 | 403;
  error: "missing_access_token" | "invalid_access_token";
  message: string;
  mode: ArticleDbAuthMode;
}

export type ArticleDbAuthResult = ArticleDbAuthSuccess | ArticleDbAuthFailure;

interface AuthConfig {
  issuer: string;
  audience: string;
  jwksUrl: string;
}

interface AuthOptions {
  allowLegacyToken?: boolean;
  allowUnconfigured?: boolean;
}

let cachedJwksUrl = "";
let cachedJwksResolver: ReturnType<typeof createRemoteJWKSet> | null = null;

function pickString(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  return "";
}

function pickNestedString(input: unknown, path: string[]): string {
  let cursor = input;
  for (const key of path) {
    if (!cursor || typeof cursor !== "object") {
      return "";
    }
    cursor = (cursor as Record<string, unknown>)[key];
  }
  return pickString(cursor);
}

function authConfig(): AuthConfig | null {
  const issuer = String(process.env.AUTH_ISSUER || "").trim();
  const audience = String(process.env.AUTH_AUDIENCE || "").trim();
  const jwksUrl = String(process.env.AUTH_JWKS_URL || "").trim();
  if (!issuer || !audience || !jwksUrl) {
    return null;
  }
  return { issuer, audience, jwksUrl };
}

function legacyToken(): string {
  return String(process.env.ARTICLE_DB_API_TOKEN || "").trim();
}

function resolveJwksResolver(jwksUrl: string): ReturnType<typeof createRemoteJWKSet> {
  if (!cachedJwksResolver || cachedJwksUrl !== jwksUrl) {
    cachedJwksUrl = jwksUrl;
    cachedJwksResolver = createRemoteJWKSet(new URL(jwksUrl));
  }
  return cachedJwksResolver;
}

function readAccessTokenFromRequest(request: Request): {
  token: string;
  source: "authorization" | "none";
} {
  const authorizationToken = parseBearerToken(request.headers.get("authorization"));
  if (authorizationToken) {
    return { token: authorizationToken, source: "authorization" };
  }
  return { token: "", source: "none" };
}

function normalizeJwtUser(payload: JWTPayload): ArticleDbAuthUser {
  const id = pickString(payload.sub) || pickNestedString(payload, ["user", "id"]);
  const email =
    pickString((payload as Record<string, unknown>).email) ||
    pickString((payload as Record<string, unknown>).upn) ||
    pickNestedString(payload, ["user", "email"]);
  const status = pickNestedString(payload, ["user", "status"]) || "ACTIVE";

  return {
    id,
    email: email.toLowerCase(),
    status,
    claims: payload as Record<string, unknown>,
  };
}

async function verifyJwtAccessToken(
  token: string,
  config: AuthConfig,
): Promise<ArticleDbAuthResult> {
  try {
    const resolver = resolveJwksResolver(config.jwksUrl);
    const verification = await jwtVerify(token, resolver, {
      issuer: config.issuer,
      audience: config.audience,
      algorithms: ["RS256"],
    });

    const user = normalizeJwtUser(verification.payload);
    if (!user.email) {
      return {
        ok: false,
        status: 401,
        error: "invalid_access_token",
        message: "missing_email_claim",
        mode: "jwt",
      };
    }

    return {
      ok: true,
      mode: "jwt",
      user,
    };
  } catch (error) {
    return {
      ok: false,
      status: 401,
      error: "invalid_access_token",
      message: error instanceof Error ? error.message : "jwt_verification_failed",
      mode: "jwt",
    };
  }
}

function success(
  mode: ArticleDbAuthMode,
  user: ArticleDbAuthUser | null = null,
): ArticleDbAuthSuccess {
  return {
    ok: true,
    mode,
    user,
  };
}

function authIsConfigured(config: AuthConfig | null, legacy: string): boolean {
  return Boolean(config || legacy);
}

export function articleDbAuthEnabled(): boolean {
  return authIsConfigured(authConfig(), legacyToken());
}

export async function authenticateArticleDbRequest(
  request: Request,
  options: AuthOptions = {},
): Promise<ArticleDbAuthResult> {
  const { allowLegacyToken = true, allowUnconfigured = true } = options;
  const config = authConfig();
  const legacy = legacyToken();

  if (!authIsConfigured(config, legacy)) {
    if (allowUnconfigured) {
      return success("none", null);
    }
    return {
      ok: false,
      status: 401,
      error: "invalid_access_token",
      message: "auth_not_configured",
      mode: "none",
    };
  }

  const { token, source } = readAccessTokenFromRequest(request);
  if (allowLegacyToken && source === "authorization" && legacy && token === legacy) {
    return success("legacy_token", null);
  }

  if (!token) {
    return {
      ok: false,
      status: 401,
      error: "missing_access_token",
      message: "missing_access_token",
      mode: "none",
    };
  }

  if (config) {
    return verifyJwtAccessToken(token, config);
  }

  return {
    ok: false,
    status: 401,
    error: "invalid_access_token",
    message: "jwt_verifier_not_configured",
    mode: "none",
  };
}

export async function authenticateAccessToken(token: string): Promise<ArticleDbAuthResult> {
  const normalized = String(token || "").trim();
  if (!normalized) {
    return {
      ok: false,
      status: 401,
      error: "missing_access_token",
      message: "missing_access_token",
      mode: "none",
    };
  }

  const config = authConfig();
  if (!config) {
    return {
      ok: false,
      status: 401,
      error: "invalid_access_token",
      message: "jwt_verifier_not_configured",
      mode: "none",
    };
  }

  return verifyJwtAccessToken(normalized, config);
}

export async function requireArticleDbAuth(request: Request): Promise<ArticleDbAuthFailure | null> {
  const authResult = await authenticateArticleDbRequest(request, {
    allowLegacyToken: true,
    allowUnconfigured: true,
  });

  if (authResult.ok) {
    return null;
  }

  return authResult;
}

export function authBridgeEnabled(): boolean {
  return Boolean(authConfig());
}

export function authIssuer(): string {
  return String(process.env.AUTH_ISSUER || "").trim();
}
