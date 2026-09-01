# news-mono

AI 新闻系统 monorepo：`article-db`（数据上游）+ `ai-news`（消费层）+ `ai-news-cli`（agent 入口）。

| 目录 | 说明 | 部署 |
|---|---|---|
| `apps/article-db` | RSS 抓取 / AI 评估 / 标签治理 / PG 归档 | Vercel sin1 + Neon Postgres |
| `apps/ai-news` | 文章展示 / flomo 推送 / 点击统计 | Vercel sin1 + Upstash Redis |
| `packages/cli` | 面向 agent 的查询 CLI（npm: `ai-news-cli`） | npm 发版 |

## 快速开始

```bash
pnpm install
pnpm build
```

架构、边界规则与运维细节见 [CLAUDE.md](./CLAUDE.md)。
