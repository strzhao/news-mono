---
active: true
phase: "merge"
gate: ""
iteration: 1
max_iterations: 30
max_retries: 3
retry_count: 0
mode: ""
plan_mode: ""
brief_file: ""
next_task: ""
auto_approve: false
knowledge_extracted: ""
task_dir: "/Users/stringzhao/workspace/agi/live/article-db/.autopilot/requirements/20260430-深入分析当前的-AI-打"
session_id: 
started_at: "2026-04-30T08:32:29Z"
---

## 目标
深入分析当前的 AI 打分问题，例如以下这个文章为什么是入选高质量: DeepSeek 的识图模式速度好快啊！这是新出的吗？ 上传图片，让反推提示词，秒出~

> 📚 项目知识库已存在: .autopilot/。design 阶段请先加载相关知识上下文。

## 设计文档

### 根因：coerceScore 边界值 10 歧义 + prompt 未指定评分尺度

bug 链：prompt 未指定尺度 → DeepSeek 返回 reading_roi_score:10（意图10/100低分）→ coerceScore 的 `score<=10` 条件将其乘以10变成100 → 无 worth↔score 交叉验证 → 文章入选高质量。

### 修复策略（5层防御）

1. **prompt 明确 0-100 尺度**：追加"所有数值评分必须是 0-100 整数"
2. **coerceScore 简化**：仅处理 0-1 归一化（`score>0 && score<=1` → `*100`），移除 0-10 支持
3. **worth↔score 交叉验证**：跳过→cap 40，必读→floor 60
4. **缓存层去除双重 coerce**：用 clampScore 替代 coerceScore
5. **ASSESSMENT_SCHEMA_VERSION → r4**：使旧缓存失效

## 实现计划

- [ ] 1. 修改 `lib/llm/article-evaluator.ts` 系统 prompt：追加 0-100 尺度说明
- [ ] 2. 修改 `lib/llm/article-evaluator.ts:43-50` 的 `coerceScore`：改为仅处理 0-1 尺度
- [ ] 3. 修改 `lib/llm/article-evaluator.ts` 的 `parseAssessment`：添加 worth↔score 交叉验证
- [ ] 4. 修改 `lib/cache/article-eval-cache.ts`：用 `clampScore` 替换 `coerceScore`，消除双重归一化
- [ ] 5. 修改 `lib/llm/article-evaluator.ts:13`：ASSESSMENT_SCHEMA_VERSION → "assessment_r4"
- [ ] 6. 添加测试覆盖：coerceScore 边界值 + worth 交叉验证逻辑

## 红队验收测试

- `tests-ts/scoring-normalization.acceptance.test.ts` — 31 个验收测试
  - Req 1: coerceScore 边界值（14 测试）
  - Req 2: worth↔qualityScore 交叉验证（12 测试）
  - Req 3: 缓存层无双重 coerce（4 测试静态分析 + 行为验证）

## QA 报告

### 轮次 1 (2026-04-30T09:04) — ✅ 全部通过

**变更分析**：3 文件修改（后端逻辑 2 + 测试 1），影响范围：低

**Wave 1 — 命令执行**

| Tier | 检查项 | 结果 | 耗时 |
|------|--------|------|------|
| Tier 0 | 红队验收测试（31个） | ✅ | 766ms |
| Tier 1 | TypeScript typecheck | ✅ | <2s |
| Tier 1 | Biome lint | ✅（84 warnings 均为已有的 `any`） | 271ms |
| Tier 1 | 全部测试（199个） | ✅ | 5.2s |
| Tier 1 | 生产构建 | ✅ | <30s |

**Wave 1.5 — 真实场景验证**

场景 1: coerceScore 边界值
- 执行: `npx tsx -e` 直接计算 coerceScore(10/0.85/75/100/0/1/1.01)
- 输出: 7/7 全部 ✅，coerceScore(10)=10 不再是 100

场景 2: worth↔score 交叉验证
- 执行: `npx tsx -e` 模拟 6 种 worth+score 组合
- 输出: 6/6 全部 ✅，跳过+高分被 cap 到 40

**Wave 2 — 跳过**（影响范围低，变更 <5 文件，无需额外 AI 审查）

**结论**：全部 ✅，可进入 merge。

## 变更日志
- [2026-04-30T08:32:29Z] autopilot 初始化，目标: 深入分析当前的 AI 打分问题，例如以下这个文章为什么是入选高质量: DeepSeek 的识图模式速度好快啊！这是新出的吗？ 上传图片，让反推提示词，秒出~
- [2026-04-30T08:45:00Z] 设计方案已通过审批（含 plan-reviewer 3 个 BLOCKER 修复后的修订版）
- [2026-04-30T09:03:00Z] 蓝队实现完成 + 红队验收测试生成完成。全部 199 测试通过，typecheck 干净。
- [2026-04-30T09:04:30Z] QA 全部通过（Wave 1 Tier 0+1 + Wave 1.5 真实场景），推进到 merge。
