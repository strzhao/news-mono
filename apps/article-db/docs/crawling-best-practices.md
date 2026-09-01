# 爬取风控最佳实践 (Crawling Risk Control Best Practices)

> 参考 jackwener 的 twitter-cli / xiaohongshu-cli / bilibili-cli 项目，结合 article-db 实际场景总结。
> 适用于 RSS 聚合、HTTP 内容抓取、Playwright 浏览器提取三层架构。

---

## 一、请求时序控制

**核心原则：** 用随机分布替代固定延迟，模拟人类不规则访问节奏。

- 高斯抖动（均值 200ms，σ=80ms）替代固定延迟
- ~5% 的请求插入 2-5s "阅读停顿"，模拟真实浏览行为
- 写操作（点赞/转发等）使用 1.5-4s 随机延迟
- 并发数按风险分级：低风险站 6 并发，高风险站（微信等）2-3

```typescript
// 高斯抖动 — 比固定延迟更自然
function gaussianJitter(baseMs: number, sigma: number): Promise<void> {
  const u1 = Math.random(), u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  const delay = Math.max(0, baseMs + z * sigma);
  return new Promise(r => setTimeout(r, delay));
}
```

**实现文件：** `lib/fetch/timing.ts`

---

## 二、重试与退避策略

**核心原则：** 指数退避 + 随机抖动，避免雷群效应。

- 统一使用 `baseDelay * 2^attempt`，加 ±20% 随机抖动
- HTTP 429 优先读取 `Retry-After` 头
- 可重试状态码白名单：`[408, 429, 500, 502, 503, 504]`
- 不同层级不同重试次数：RSS 1 次、HTTP 内容 2 次、浏览器提取 1 次
- 重试间隔上限 30s，防止单个请求阻塞 worker

```typescript
async function retryWithBackoff<T>(fn: () => Promise<T>, opts) {
  for (let attempt = 0; ; attempt++) {
    try { return await fn(); }
    catch (err) {
      if (attempt >= opts.maxRetries || !isRetryable(err)) throw err;
      const jitter = 0.8 + Math.random() * 0.4;
      const delay = Math.min(opts.baseDelayMs * 2 ** attempt * jitter, 30_000);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}
```

**实现文件：** `lib/fetch/retry.ts`

---

## 三、自适应限速

**核心原则：** 按域名动态调整延迟，限流时加倍，成功时缓慢恢复。

- `AdaptiveThrottle` 类，按域名维护延迟倍数，初始 1.0
- 限流信号（429/403/461/471）→ 倍数翻倍 `1x → 2x → 4x → 8x`
- 连续成功 → 缓慢恢复（每 10 次成功 `*= 0.9`）
- 触发验证码后，该域名基础延迟永久翻倍（本次 run 内）
- 达到最大倍数后标记 `degraded`，跳过剩余请求

**实现文件：** `lib/fetch/throttle.ts`

---

## 四、请求头与身份伪装

**核心原则：** Session-stable UA + 完整浏览器请求头集，内部一致。

- RSS 层保持轻量（RSS 服务器通常不做反爬）
- HTTP 内容抓取使用真实浏览器 UA + 完整 sec-ch-ua 头
- UA 池维护 3-5 个当前主流 Chrome 版本，session-stable
- `sec-ch-ua` 版本号必须与 UA 中的 Chrome 版本对齐

```typescript
const UA_PROFILES = [
  {
    ua: "Mozilla/5.0 (Macintosh; ...) Chrome/133.0.0.0 Safari/537.36",
    secChUa: '"Chromium";v="133", "Google Chrome";v="133", ...',
  },
  // ... 更多版本
];
// 每次 run 开始时选定一个 profile，全程复用
const sessionProfile = UA_PROFILES[Math.floor(Math.random() * UA_PROFILES.length)];
```

**实现文件：** `lib/fetch/headers.ts`

---

## 五、浏览器指纹一致性

**核心原则：** 同一 IP 短时间内不应出现多个不同浏览器指纹。

- Session-stable 指纹：UA/viewport/GPU 在一次会话内生成一次，全程复用
- viewport 从预设池随机选择：`[1440x900, 1920x1080, 1536x864, 1366x768]`
- 完整反检测脚本：
  - `navigator.webdriver = false`
  - `navigator.plugins` 模拟 Chrome 默认插件
  - `navigator.languages` 设置
  - `window.chrome` / `chrome.runtime` 存在性模拟
  - `Permissions.query` notifications → denied
  - WebGL vendor/renderer 模拟

**实现文件：** `extraction-worker/src/extractors/browser.ts`

---

## 六、验证码检测与处理

**核心原则：** 检测到验证码后标记跳过，不无限等待。

- 页面导航后检测常见验证码元素（滑块、iframe、特定 class）
- 检测到 → 记录日志 + 标记 `captcha_blocked` + 跳过
- HTTP 层检测 461/471 状态码作为验证码信号
- 触发后自动提升该域名的请求间隔

---

## 七、错误分类与可观测性

**核心原则：** 结构化错误码驱动重试决策和可观测性。

- 错误码：`rate_limited | captcha_blocked | timeout | upstream_error | network_error | content_type_mismatch`
- 每个错误携带：`code`、`statusCode`、`retryable`、`domain`
- Ingestion stats 新增维度：
  - `fetch_error_codes: Record<string, number>` — 各错误码计数
  - `hq_content_crawl_error_codes` — HQ 抓取错误分布
- 只有 `retryable=true` 的错误才进入重试

**实现文件：** `lib/fetch/errors.ts`

---

## 八、代理与 IP 策略

- 代理池支持：`PROXY_POOL` 环境变量，逗号分隔，HTTP/SOCKS5
- Round-robin 轮换 + 健康检查（失败标记 unhealthy 30 分钟后重试）
- 住宅代理优于数据中心代理（被封概率更低）
- 高风险域名走代理，低风险域名直连

---

## 九、Cookie 与会话管理

- 三级认证策略：本地缓存 → 浏览器 cookie 提取 → 交互式登录
- Cookie 有效期管理：默认 7 天，过期自动刷新
- 通用浏览器提取维护 cookie jar，跨请求复用同域名 cookie

---

## 十、去重与规范化

- 双重去重：URL（去除追踪参数）+ 标题（Levenshtein ≥ 0.93）
- 追踪参数清理：`utm_*`、`spm`、`fbclid`、`gclid`、`ref`
- canonical URL 优先使用 `entry.link`
- `selectInfoUrl()` 过滤媒体 URL

**实现文件：** `lib/process/dedupe.ts`、`lib/fetch/rss-fetcher.ts`

---

## 十一、优雅降级

- 单源失败不中断整体流程
- 图片下载失败回退到原始 URL
- 域名级降级：连续失败 N 次后本次 run 内跳过该域名
- 总错误率熔断：超过 50% 提前终止 run 并报警
- Stale run watchdog（900s 无心跳标记失败）

---

## 十二、设计原则总结

| 原则 | 说明 |
|------|------|
| Session-stable | UA/viewport/指纹在一次 run 内不变 |
| 分层策略 | RSS 轻量、HTTP 中等、浏览器重度 |
| 环境变量驱动 | 所有阈值通过环境变量控制 |
| 零新依赖 | 高斯分布、退避、UA 池纯 TypeScript |
| 可观测优先 | 结构化错误码 + 统计维度 |
| 渐进式增强 | P0→P1→P2 分阶段实施 |

---

## 参考来源

- [jackwener/twitter-cli](https://github.com/jackwener/twitter-cli) — TLS 指纹、请求头伪装、指数退避
- [jackwener/xiaohongshu-cli](https://github.com/jackwener/xiaohongshu-cli) — 高斯抖动、session-stable 指纹、验证码检测
- [jackwener/bilibili-cli](https://github.com/jackwener/bilibili-cli) — 三级认证、结构化错误码
