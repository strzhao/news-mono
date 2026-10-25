# syntax=docker/dockerfile:1.7
# article-db 自托管部署（pnpm monorepo + Next.js standalone；Vercel→VPS 2026-10-25）
# local build：docker buildx --platform linux/amd64 -f deploy/article-db/Dockerfile -t article-db:latest --load .
# 数据层外部化：Neon PG + Upstash + Vercel Blob 走运行时 env_file（apps/article-db/.env.production），镜像零凭据

# ---------- base ----------
FROM node:22-alpine AS base
RUN apk add --no-cache libc6-compat
WORKDIR /app
# corepack 按 packageManager(pnpm@11) 拉 pnpm；镜像源指向 npmmirror（容器内直连 npmjs 不稳，little-ant 实录）
ENV COREPACK_NPM_REGISTRY=https://registry.npmmirror.com
RUN corepack enable

# ---------- builder（单阶段：pnpm workspace 布局跨阶段 COPY 符号链接目录易碎，合并最稳）----------
FROM base AS builder
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/ai-news/package.json apps/ai-news/
COPY apps/article-db/package.json apps/article-db/
COPY packages/cli/package.json packages/cli/
RUN pnpm config set registry https://registry.npmmirror.com && pnpm install --frozen-lockfile

COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# 触发 next.config.ts 的 output:'standalone'
ENV DOCKER_BUILD=1
# 无 NEXT_PUBLIC_*（纯服务端）；页面均动态（auth 门禁），构建期不连 DB
RUN pnpm --filter article-db build

# ---------- runner ----------
FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3006 HOSTNAME=0.0.0.0

# monorepo standalone 产物按 workspace 结构落盘：server.js 在 apps/article-db/ 下（base-account 坑⑦同款）
# 注意：article-db 无 public/ 目录，勿 COPY（base-account 坑⑦同款）
COPY --from=builder /app/apps/article-db/.next/standalone ./
COPY --from=builder /app/apps/article-db/.next/static ./apps/article-db/.next/static

EXPOSE 3006
CMD ["node", "apps/article-db/server.js"]
