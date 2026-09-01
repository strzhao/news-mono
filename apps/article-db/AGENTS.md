# Repository Guidelines

## Project Structure & Module Organization
- `app/`: Next.js App Router pages and API handlers.
  - `app/api/`: public and internal endpoints (`/api/archive_articles`, `/api/v1/*`, tracker routes).
  - `app/archive-review/`: archive review UI.
- `lib/`: core business logic by domain.
  - `lib/article-db/`: ingestion, repository, auth, migration.
  - `lib/domain/`: archive, tracker, and shared domain utilities.
  - `lib/output/`: markdown/flomo formatters.
  - `lib/integrations/`, `lib/tracking/`, `lib/fetch/`, `lib/llm/`: external clients and pipelines.
- `tests-ts/`: Vitest unit/integration-style tests (`*.test.ts`).
- `config/`: source and type configuration YAML.
- `db/`: SQL or DB artifacts.

## Build, Test, and Development Commands
- `npm run dev`: run local Next.js dev server.
- `npm run build`: production build (also generates Next type artifacts).
- `npm run start`: run the built app.
- `npm run typecheck`: strict TypeScript check (`tsc --noEmit`).
- `npm test`: run all tests once with Vitest.
- `npm run test:watch`: watch mode for iterative testing.

## Coding Style & Naming Conventions
- Language: TypeScript (`strict: true`).
- Indentation: 2 spaces; keep functions small and explicit.
- Files: kebab-case for modules (e.g., `flomo-archive-articles-formatter.ts`); Next handlers use `route.ts`.
- Prefer named exports for shared utilities.
- Keep API responses stable: include `ok`, explicit error messages, and predictable keys.
- No dedicated lint script is configured; enforce style via consistency + typecheck + tests.

## Testing Guidelines
- Framework: Vitest (`tests-ts/`).
- Name tests as `*.test.ts`, grouped by feature/route.
- For API routes, test at least:
  - auth failures,
  - success path,
  - empty/fallback path,
  - external dependency failure path.
- Run `npm test` and `npm run typecheck` before opening a PR.

## Commit & Pull Request Guidelines
- Follow Conventional Commit style seen in history:
  - `feat: ...`, `fix: ...`, `chore: ...`, optionally scoped (`feat(归档): ...`).
- Keep each commit focused and runnable.
- PRs should include:
  - change summary,
  - affected endpoints/files,
  - env var changes,
  - test/build results,
  - screenshots for UI changes (`/`, `/archive-review`).

## Security & Configuration Tips
- Never commit secrets. Use `.env.local` for local values.
- Key sensitive vars: `CRON_SECRET`, `TRACKER_SIGNING_SECRET`, `ARTICLE_DB_API_TOKEN`, `FLOMO_API_URL`.
- When changing cron-triggered APIs, update both `vercel.json` and `README.md` together.

## Flomo Integration Rules (Important)
- Single flomo path only: keep `GET /api/v1/flomo/push-from-archive-articles` as the only flomo delivery path.
- Legacy digest flomo flow is removed intentionally; do not re-introduce `lib/output/flomo-formatter.ts` or digest-runner direct flomo sync.
- flomo tags must be appended at the very end of content.
- Tag source is `tag_groups` only (not primary/secondary type fallback).
- Tag format must be `#tag` with no spaces in tag text; normalize to snake_case-compatible keys.
- Tag canonicalization must reuse active `tag_registry` definitions (alias -> canonical).
- Preserve one-time consumption guarantees using existing Postgres state:
  - `flomo_archive_push_batches`
  - `flomo_archive_article_consumption`

## Implementation Notes (2026-03-03)
- 接入统一账号授权入口：必须从 `AUTH_ISSUER/authorize` 进入，不允许直连本地 `/login` 验证码流程。
- 本地登录态改为短期网关会话：
  - `GET /auth/start`：生成 state 并跳转统一授权。
  - `GET /auth/callback`：处理回跳并调用本地 finalize 接口，由服务端读取统一账号 cookie。
  - `POST /api/auth/session/finalize`：校验 state + JWT + allowlist，写入 `article_db_gateway_session`。
  - `POST /api/auth/session/logout`：清理本地网关会话。
- 旧本地桥接接口 `POST /api/auth/send-code|verify-code|refresh|logout`、`GET /api/auth/me` 已统一废弃为 `410 deprecated_auth_endpoint`。
- 白名单模式生效：`AUTH_EMAIL_ALLOWLIST` 精确控制可访问账号（当前允许 `daniel21436@hotmail.com,zhaoguixing@corp.netease.com`）。
- `/archive-review` 已启用登录保护，未登录自动跳转 `/auth/start`。
- 现有受保护 `/api/v1/*` 路由保持统一鉴权结果：明确 `401/403` 与 `error` 字段，附带 `auth_mode`。
- 环境变量约定：
  - `AUTH_ISSUER`
  - `AUTH_AUDIENCE`
  - `AUTH_JWKS_URL`
  - `AUTH_EMAIL_ALLOWLIST`
  - `AUTH_GATEWAY_SESSION_SECRET`（可选，未配置时回退 `TRACKER_SIGNING_SECRET` / `CRON_SECRET`）
- 当前白名单邮箱已按“全局 git email”对齐为：`daniel21436@hotmail.com`。
- 当前对外访问域名：`https://article-db.stringzhao.life`（已绑定到 `article-db` 项目）。
