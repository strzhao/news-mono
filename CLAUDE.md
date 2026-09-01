# news-mono

AI 新闻系统 monorepo（2026-08-31 由 article-db + ai-news + ai-news-cli 三仓合并，历史完整保留）。

## 系统拓扑

```
apps/article-db   数据上游    RSS 抓取 / AI 评估 / 标签治理 / PG 归档（Neon Postgres）
apps/ai-news      消费层      文章展示 / flomo 推送 / 点击统计（Upstash Redis）
packages/cli      agent 入口  npm 包 ai-news-cli，读 ai-news 的数据做终端查询
```

- ai-news 通过 HTTP API 消费 article-db：`lib/integrations/article-db-client.ts`，配置 `ARTICLE_DB_BASE_URL` / `ARTICLE_DB_API_TOKEN`
- 两 app 均部署 Vercel sin1，`vercel.json`（含 cron）随各自目录走：
  - article-db cron：`/api/v1/ingestion/run` 每日 02:00、`/api/v1/blob-cleanup` 每日 04:00（原每小时抓取因 Vercel Hobby 套餐限制降级为每日，2026-09-01）
  - ai-news cron：flomo / web-push 定时推送、每日 editorial

## 命令

根目录统一入口（pnpm -r 透传，子包无对应 script 时自动跳过）：

```bash
pnpm install                 # 根级一次装全仓
pnpm build                   # 全部构建（Next build ×2 + tsup ×1）
pnpm typecheck
pnpm test

pnpm --filter ai-news dev        # 本地起 ai-news（:3721）
pnpm --filter article-db dev
```

## 边界规则

- **apps 之间不互相 import**；ai-news ↔ article-db 只走 HTTP API 契约，契约变更同一 PR 原子更新两侧
- `apps/article-db/extraction-worker/` 是 PM2 管的长驻 worker（Playwright/yt-dlp），**不在 pnpm workspace 内、保留自己的 npm lockfile**——它有独立安装/部署生命周期，不要并入根 lockfile。生产实例跑在私有 VPS（article-db 的 `BROWSER_EXTRACT_URL` 指向它），本机目录只是开发副本
- `@stringzhao/auth-sdk` 走 npm 发包（base-account 仓），**不进本仓**
- 工具链分区：ai-news 用 **biome**（`pnpm --filter ai-news lint`，biome.json 在其目录内自洽）；article-db / cli 只 tsc。不要在根上放全仓 glob formatter 去重排另一侧的代码
- cli 不硬编码业务命令；对 ai-news API 的契约变更与 cli 适配同一 PR 完成

## cli 发版（低频）

npm 上 `ai-news-cli` 的 trusted publisher 仍绑定旧仓 ai-news-cli 的 publish.yml。要在本仓发新版，需先人工在 npm 侧换绑（交互 2FA）：

```bash
npx npm@11 trust list ai-news-cli      # 拿旧配置 ID
npx npm@11 trust revoke ai-news-cli --id=<ID>
npx npm@11 trust github ai-news-cli --file .github/workflows/publish-ai-news-cli.yml --repo strzhao/news-mono --env npm --allow-publish
```

之后 tag `ai-news-cli-v*` 触发主仓 publish workflow，版本号须与 `packages/cli/package.json` 一致。

## 部署

- Vercel 两个 project，root directory 分别指 `apps/article-db`、`apps/ai-news`，git 集成指向本仓；环境变量不变
- 数据库不变：article-db = Neon Postgres，ai-news = Upstash Redis
