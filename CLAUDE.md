# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

article-db 是一个 AI 驱动的文章智能分析服务，基于 Next.js 15 (App Router) + TypeScript + PostgreSQL 构建。核心职责：RSS 抓取 → AI 质量评估(DeepSeek) → 高质量文章筛选 → 对外 API 提供数据。

## 线上服务

- 自定义域名: https://article-db.stringzhao.life
- Vercel 域名: https://article-db.vercel.app（国内不可达，操作时用自定义域名）
- Vercel 区域: sin1 (新加坡)
- Cron: ingestion 每小时执行，ingestion-monitor 每 3 小时执行，blob-cleanup 每日 4:00 UTC

## 常用命令

```bash
npm run dev          # 本地开发服务器
npm run build        # 生产构建
npm run typecheck    # TypeScript 严格检查 (tsc --noEmit)
npm run lint         # Biome lint 检查
npm run lint:fix     # Biome 自动修复
npm run format       # Biome 格式化
npm test             # Vitest 运行全部测试
npm run test:watch   # Vitest watch 模式
```

运行单个测试文件：
```bash
npx vitest run tests-ts/article-content-fetcher.test.ts
```

## 手动触发 Ingestion

```
GET /api/v1/ingestion/run?trigger=manual&token={CRON_SECRET}
```
需要 CRON_SECRET 认证（Vercel 生产环境变量），最长运行 300 秒。

## 核心架构

### Ingestion Pipeline（核心数据流）

```
Cron/手动触发 → loadSources(config/sources.yaml, 46+ 源)
  → RSS 抓取(rss-fetcher) → 去重(dedupe) → 规范化(normalize)
  → AI 评估(article-evaluator → DeepSeek) → 缓存(LRU + Upstash Redis)
  → 入库(repository.upsertArticles → Postgres)
  → 筛选高质量文章(daily_high_quality_articles)
  → 批量生成摘要 → 记录 ingestion_runs 遥测
```

### 目录职责

- `app/api/v1/` — REST API 端点（ingestion、articles、tags、flomo、observability、maintenance）
- `app/archive-review/` — 受保护的文章审阅 UI（需网关会话登录）
- `lib/article-db/` — 核心业务层：repository(~3200行 Postgres ORM)、ingestion-runner、auth
- `lib/domain/` — 领域模型、URL 去重、平台识别、文章身份识别(article-identity)
- `lib/fetch/` — 抓取层：RSS 解析、反检测基础设施（指纹伪装、指数退避、自适应限流）
- `lib/llm/` — LLM 推理：DeepSeek 客户端、文章评估器、摘要生成
- `lib/process/` — 处理管线：去重、规范化、信息聚类
- `lib/infra/` — 基础设施：Postgres 连接池、Upstash Redis、HTTP 工具
- `lib/cache/` — LRU 评估缓存
- `config/` — YAML 配置（sources、scoring、tagging、article_types）
- `db/migrations/` — PostgreSQL schema 迁移脚本（001-008）
- `scripts/` — 运维脚本（如微信归档修复 repair-wechat-archive）
- `extraction-worker/` — 独立 Playwright 提取服务（Instagram、小红书、YouTube、B站）
- `tests-ts/` — Vitest 测试（30+ 文件）

### 认证体系

统一账号授权流程（非本地验证码）：
1. `/auth/start` → 生成 state → 跳转 `AUTH_ISSUER/authorize`
2. OAuth 回调 → `/auth/callback`
3. `POST /api/auth/session/finalize` → 校验 JWT + allowlist → 写入 `article_db_gateway_session` cookie
4. 旧端点(send-code/verify-code/refresh/me/logout)已废弃返回 410

API 鉴权：JWT (`Authorization: Bearer`) 或 `ARTICLE_DB_API_TOKEN` (query token)。

### 关键环境变量

必须：`DATABASE_URL`, `DEEPSEEK_API_KEY`
认证：`AUTH_ISSUER`, `AUTH_AUDIENCE`, `AUTH_JWKS_URL`, `AUTH_EMAIL_ALLOWLIST`
运行：`CRON_SECRET`, `ARTICLE_DB_API_TOKEN`, `RSSHUB_BASE_URL`, `BROWSER_EXTRACT_URL`
监控告警：`AI_TODO_API_URL`, `AI_TODO_SPACE_ID`, `AI_TODO_SPACE_TOKEN`（空间 API Token，从 ai-todo 空间设置获取）
缓存：`UPSTASH_REDIS_REST_URL`, `UPSTASH_REDIS_REST_TOKEN`

## 编码规范

- TypeScript strict 模式，2 空格缩进
- 文件名 kebab-case（如 `article-content-fetcher.ts`），Next.js handler 用 `route.ts`
- 路径别名 `@/*` 映射到项目根目录
- API 响应保持稳定：包含 `ok` 字段、明确错误消息、可预测的 key
- Biome 做 lint + format；通过 typecheck + lint + tests 保证质量
- pre-commit hook (husky + lint-staged) 自动运行 biome check

## 测试规范

- 框架：Vitest，Node 环境，globals 启用
- 测试文件在 `tests-ts/`，命名 `*.test.ts`
- API 路由测试需覆盖：认证失败、成功路径、空/回退路径、外部依赖失败路径
- 提交前运行 `npm test` 和 `npm run typecheck`（pre-commit hook 自动运行 lint）

## 提交规范

- Conventional Commits：`feat: ...`, `fix: ...`, `chore: ...`
- 可选中文 scope：`feat(归档): ...`, `fix(摄入): ...`
- 每个 commit 保持聚焦和可运行

## Flomo 集成规则

- 仅保留单一推送路径，不重新引入已移除的 legacy digest flomo 流程
- Tag 来源仅限 `tag_groups`，格式 `#snake_case`，附在内容末尾
- 消费保证依赖 Postgres 状态表：`flomo_archive_push_batches` / `flomo_archive_article_consumption`

## 数据库

PostgreSQL，核心表：sources、articles、article_analysis、daily_high_quality_articles、article_summaries、ingestion_runs、tag_groups、flomo_archive_push_batches。迁移脚本在 `db/migrations/` (001-008)。
