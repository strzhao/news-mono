# syntax=docker/dockerfile:1.7
# ai-news 自托管部署（pnpm monorepo + Next.js standalone；Vercel→VPS 2026-10-25）
# local build：docker buildx --platform linux/amd64 -f deploy/ai-news/Dockerfile -t ai-news:latest --load .
# 数据层外部化：Neon PG + Upstash 走运行时 env_file（apps/ai-news/.env.production），镜像零凭据

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
# NEXT_PUBLIC_* 在构建期内联进客户端 bundle（运行时 env 改不了，必须是构建参数）；
# 全部为公开值（域名/路径），无凭据
ENV NEXT_PUBLIC_APP_ORIGIN="https://ai-news.stringzhao.life" \
    NEXT_PUBLIC_AUTH_ISSUER="https://user.stringzhao.life" \
    NEXT_PUBLIC_AUTH_AUTHORIZE_PATH="/authorize" \
    NEXT_PUBLIC_AUTH_CALLBACK_PATH="/auth/callback" \
    NEXT_PUBLIC_AUTH_ME_PATH="/api/auth/me" \
    NEXT_PUBLIC_AUTH_LOGOUT_PATH="/api/auth/logout"
RUN pnpm --filter ai-news build

# ---------- runner ----------
FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3007 HOSTNAME=0.0.0.0

# monorepo standalone 产物按 workspace 结构落盘：server.js 在 apps/ai-news/ 下（base-account 坑⑦同款）
COPY --from=builder /app/apps/ai-news/.next/standalone ./
COPY --from=builder /app/apps/ai-news/.next/static ./apps/ai-news/.next/static
COPY --from=builder /app/apps/ai-news/public ./apps/ai-news/public

EXPOSE 3007
CMD ["node", "apps/ai-news/server.js"]
