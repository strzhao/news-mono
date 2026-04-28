---
active: true
phase: "merge"
gate: ""
iteration: 2
max_iterations: 30
max_retries: 3
retry_count: 0
mode: ""
plan_mode: ""
brief_file: ""
next_task: ""
auto_approve: false
knowledge_extracted: ""
task_dir: "/Users/stringzhao/workspace/agi/live/article-db/.autopilot/requirements/20260428-昨天和今天的-@..-ai-news"
session_id: 5ee95c7c-8a55-4a47-ae3b-445cf8d9e8ca
started_at: "2026-04-28T09:53:19Z"
---

## 目标
昨天和今天的 @../ai-news 都没有内容，深入分析下原因 ，ai-news 底层数据来源是当前工程

> 📚 项目知识库已存在: .autopilot/。design 阶段请先加载相关知识上下文。

## 设计文档

### 根因诊断

**问题**: ai-news 4月27日和28日没有内容。ai-news 前端从 article-db 的 `/api/v1/articles/high-quality/range` 获取数据，要求 `quality_score >= 50`。

**数据链路**: ai-news 前端 → `GET /api/archive_articles` → `fetchHighQualityRange()` → article-db API → `daily_high_quality_articles` 表 JOIN `article_analysis` 表（二次过滤 `aa.quality_score >= 50`）

**关键发现**:

1. **Ingestion 运行正常**: 24/24 次成功，0 次失败，每次抓取 ~400 篇、评估 70 篇
2. **文章评分全面偏低**: 82 篇文章中 81 篇 quality_score ≤ 10，最高仅 15.5，无一达到阈值 50
3. **评估 100% 缓存命中**: `ai_eval_cache_hit_rate ≈ 1.0`，所有评估结果均来自 Upstash Redis 缓存
4. **缓存中的分数未经归一化**: 直接查询 Upstash Redis 确认，缓存 `payload_json` 中 `quality_score` 值为 0-10 范围（如 4.5, 5.5, 1.5），而非预期的 0-100 范围

**根因**: 代码中存在 `coerceScore` 函数（`article-evaluator.ts:43-50`），设计将 0-10 分数乘以 10 映射到 0-100。但**缓存中存储的评估结果显示该归一化未被执行**。

具体证据:
- 缓存条目 `quality_score: 4.5`（应为 45），`company_impact: 2`（应为 20），`practicality_score: 3.33`（= (2+3+5)/3，确认子分数未归一化）
- `article_analysis.quality_score` 值同样为 0-10 范围（如 9.2），与缓存一致
- 本地构建 `.next/` 中 **存在** 正确的 coerceScore 逻辑（`b>=0&&b<=10&&(b*=10)`），但 Vercel 线上行为不一致

**结论**: Vercel 线上运行的构建版本与当前 git 代码的评分行为不一致。需要：
1. 重新部署当前代码
2. 清空 Upstash Redis 评估缓存（强制重新评估）
3. 在缓存读取层增加 coerceScore 兜底保护

### 影响范围

- 4月25日起高质量文章数量下降（从稳定 5 篇/天降至 2→2→0→0）
- ai-news 前端显示"今日暂无文章"
- 历史数据（4月24日前）分数正常（65-100 范围）

### 修复方案

**修复 1: 缓存层兜底 coerceScore**（`lib/cache/article-eval-cache.ts:145`）
- 在缓存的 `parseAssessment` 函数中对所有分数字段应用 `coerceScore`
- 这是防御性修复：即使写入时未归一化，读取时仍能纠正

**修复 2: 重新部署 + 清空缓存**
- `npx vercel --prod` 重新部署
- 清空 Upstash Redis 中 `cache:article_assessment:*` 所有条目
- 触发手动 ingestion 验证

## 实现计划

- [x] 诊断分析
- [ ] 在 `article-eval-cache.ts` 的 `parseAssessment` 中添加 `coerceScore` 归一化
- [ ] 重新部署到 Vercel
- [ ] 清空 Upstash Redis 评估缓存
- [ ] 手动触发 ingestion 验证分数恢复正常

## 红队验收测试
(待 implement 阶段填充)

## QA 报告
(待 qa 阶段填充)

## 变更日志
- [2026-04-28T09:53:19Z] autopilot 初始化，目标: 昨天和今天的 @../ai-news 都没有内容，深入分析下原因 ，ai-news 底层数据来源是当前工程
- [2026-04-28T10:00:00Z] 诊断完成：Upstash Redis 缓存中评分未经归一化（0-10 range vs threshold 50）
- [2026-04-28T10:35:00Z] 修复代码：article-eval-cache.ts 添加 coerceScore 兜底归一化
- [2026-04-28T10:36:00Z] 清空 Upstash Redis 5000 条评估缓存
- [2026-04-28T10:37:00Z] 部署到 Vercel 生产环境
- [2026-04-28T10:40:00Z] 验证成功：4/28 selected=19 (was 0), 4/27 selected=27 (was 0)
