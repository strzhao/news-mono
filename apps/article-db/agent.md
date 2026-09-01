# Agent Notes (2026-03-03)

## 本次改造（统一账号接入版）
- 已移除本地验证码登录流程入口：`/login` 现在只负责跳转 `/auth/start`。
- 已新增统一授权入口：`GET /auth/start`（生成 state + 跳转 `https://user.stringzhao.life/authorize`）。
- 已新增统一授权回调页：`GET /auth/callback`（处理 `authorized/state` 并调用本地 finalize）。
- 已新增本地会话落地接口：`POST /api/auth/session/finalize`（校验 state + 读取 `access_token` cookie 验签 + allowlist）。
- 已修复授权回跳 `Failed to fetch`：回调页不再直接跨域请求 `user.stringzhao.life/api/auth/me`，改为只调用本域 finalize 接口，避免浏览器 CORS 阻断。
- 已增强回调失败交互：当出现 `forbidden_not_in_allowlist` 等错误时，支持“重试回跳”与“重新授权”手动重试。
- 已新增本地会话注销接口：`POST /api/auth/session/logout`（清理 `article_db_gateway_session`）。
- 已将旧本地账号桥接接口统一废弃为 `410`：
  - `POST /api/auth/send-code`
  - `POST /api/auth/verify-code`
  - `POST /api/auth/refresh`
  - `POST /api/auth/logout`
  - `GET /api/auth/me`
- `/archive-review` 已切换为检查 `article_db_gateway_session`，未登录会跳转统一授权入口。

## 白名单与域名
- 白名单邮箱：`daniel21436@hotmail.com,zhaoguixing@corp.netease.com`。
- 应用域名：`https://article-db.stringzhao.life`。

## 关键环境变量
- `AUTH_ISSUER=https://user.stringzhao.life`
- `AUTH_AUDIENCE=base-account-client`
- `AUTH_JWKS_URL=https://user.stringzhao.life/.well-known/jwks.json`
- `AUTH_EMAIL_ALLOWLIST=daniel21436@hotmail.com,zhaoguixing@corp.netease.com`
- `AUTH_GATEWAY_SESSION_SECRET`（可选，未配时回退到 `TRACKER_SIGNING_SECRET` / `CRON_SECRET`）

## 下一步
- 执行并通过 `npm run typecheck && npm test`。
- 提交代码并推送远端。
- 执行部署（Vercel）并在 `article-db.stringzhao.life` 做一次完整回归：
  1. 访问 `/archive-review` 是否跳转 `/auth/start`。
  2. 统一账号登录后是否回跳 `/auth/callback` 并进入审查页。
  3. 非白名单账号是否被 `403 forbidden_not_in_allowlist` 拒绝。
