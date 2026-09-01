# article-db (Analysis Service)

`article-db` 是 AI 文章分析基础服务，负责：

- RSS 抓取与去重
- AI 质量评估与标签治理
- Postgres 归档（高质量、全量分析、运行记录）
- 对外提供文章查询与治理 API
- 提供 flomo 推送批次状态接口（`next/sent/failed`）

## Core APIs

- `GET /api/v1/ingestion/run`
- `GET /api/v1/articles/high-quality`
- `GET /api/v1/articles/high-quality/range`
- `GET /api/v1/articles/archive-list`
- `GET /api/v1/articles/:article_id`
- `POST /api/v1/articles/feedback`
- `GET /api/v1/runs/:date`
- `GET /api/v1/observability/ai`
- `GET /api/v1/tags/groups`
- `PUT /api/v1/tags/groups/:group_key/:tag_key`
- `DELETE /api/v1/tags/groups/:group_key/:tag_key`
- `POST /api/v1/tags/governance/run`
- `GET/PUT /api/v1/tags/governance/objective`
- `GET/POST /api/v1/tags/governance/feedback`
- `POST /api/v1/flomo/push-batches/next`
- `POST /api/v1/flomo/push-batches/:batch_key/sent`
- `POST /api/v1/flomo/push-batches/:batch_key/failed`
- `GET /auth/start` (统一授权入口跳转)
- `GET /auth/callback` (统一授权回跳处理页)
- `POST /api/auth/session/finalize` (本地网关会话落地)
- `POST /api/auth/session/logout` (本地网关会话清理)

## Environment Variables

### Required

- `DATABASE_URL`
- `DEEPSEEK_API_KEY`

### Recommended

- `ARTICLE_DB_API_TOKEN`
- `CRON_SECRET`
- `WECHAT_SOGOU_MAX_AGE_DAYS` (default `3`, WeChat only keeps report-day / recent 3-day articles; stale hits auto-fallback to RSS)
- `INGESTION_WECHAT_RESERVED_EVAL_ARTICLES` (default `3`, reserve a few recent WeChat items into evaluation pool)
- `INGESTION_WECHAT_RESERVED_MAX_AGE_DAYS` (default `3`, only reserve WeChat items within report-day / recent 3-day window)
- `AUTH_ISSUER`
- `AUTH_AUDIENCE`
- `AUTH_JWKS_URL`
- `AUTH_EMAIL_ALLOWLIST` (comma-separated emails, whitelist mode)
- `AUTH_GATEWAY_SESSION_SECRET` (optional, fallback to `TRACKER_SIGNING_SECRET` / `CRON_SECRET`)

## Development

```bash
npm install
npm run dev
npm run typecheck
npm test
```

## Independent Neon Migration

`article-db` 现在提供了标准化迁库脚本，用于把共享库中的文章分析数据迁到独立 Neon：

```bash
# 1) 先在目标库建 schema
TARGET_DATABASE_URL='postgresql://...' npm run db:bootstrap

# 2) 从共享库复制 article-db 全部表到新库
SOURCE_DATABASE_URL='postgresql://shared...' \
TARGET_DATABASE_URL='postgresql://new...' \
npm run db:clone -- --truncate-target

# 3) 对新旧库做逐表校验
SOURCE_DATABASE_URL='postgresql://shared...' \
TARGET_DATABASE_URL='postgresql://new...' \
npm run db:verify
```

脚本会迁移并校验以下核心表：

- `sources`
- `articles`
- `article_related_images`
- `article_analysis`
- `daily_high_quality_articles`
- `daily_analyzed_articles`
- `ingestion_runs`
- `tag_registry`
- `tag_governance_*`
- `article_quality_feedback`
- `flomo_archive_push_batches`
- `flomo_archive_article_consumption`
- `article_summaries`

建议切换顺序：

1. 暂停 `article-db` ingestion cron 和 `ai-news` 的 flomo / web-push cron
2. 执行 `db:bootstrap`、`db:clone`、`db:verify`
3. 把 `article-db` 项目的 `DATABASE_URL` 切到新库并重新部署
4. 保持 `ai-news` 的 `ARTICLE_DB_BASE_URL` 指向 `article-db` 服务；删除 `ai-news` 项目中的旧 `DATABASE_URL/POSTGRES_URL*`
5. 验证消费层接口后恢复 cron

## Deployment

`vercel.json` 仅保留 ingestion cron：

- `0 * * * *` (UTC) -> `/api/v1/ingestion/run`

消费层仓库 `ai-news` 通过 `ARTICLE_DB_BASE_URL` + `ARTICLE_DB_API_TOKEN` 调用本服务。

当 `AUTH_ISSUER` / `AUTH_AUDIENCE` / `AUTH_JWKS_URL` 配置后：

- `/archive-review` 启用统一账号保护，未登录会跳转 `/auth/start`，并由账号中心 `/authorize` 完成登录授权。
- 回跳 `/auth/callback` 后由本服务端读取统一账号 cookie 中的 `access_token` 完成 JWT 验签，再落地本地 `article_db_gateway_session`（避免前端跨域调用）。
- 登录用户必须命中 `AUTH_EMAIL_ALLOWLIST`（当前允许 `daniel21436@hotmail.com,zhaoguixing@corp.netease.com`）。
- 旧 `/api/auth/send-code|verify-code|refresh|logout|me` 已废弃并统一返回 `410 deprecated_auth_endpoint`。
- `/api/v1/*` 仍支持 JWT（统一 issuer/audience/jwks），并保留 `ARTICLE_DB_API_TOKEN` 供非账号体系调用方兼容使用。
