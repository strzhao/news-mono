# AI 主编圆桌播客 — 设计文档

> 日期：2026-04-11
> 状态：待实施

## 概述

在现有主编日报的基础上，新增每日播客节目。当日主编邀请 2 位嘉宾主编，围绕昨天 19:00 到今天 07:00 之间的高质量文章展开真实辩论式对谈，生成约 20 分钟的音频播客。

## 核心决策

| 维度 | 决定 |
|------|------|
| 输出形态 | 真实音频 MP3 |
| TTS 服务 | 火山引擎 TTS |
| 参与人数 | 当值主编（主持）+ 2 位嘉宾 |
| 嘉宾选择 | 按文章内容智能匹配 |
| 时长 | ~20 分钟（~4000-5000 字脚本） |
| 对谈风格 | 真实辩论型 |
| 触发时机 | 跟随日报 cron（晨间版之后） |
| 质量把控 | LLM 自审迭代（技术准确性、观点深度、对谈自然度，各 >= 7/10） |
| 音频存储 | Vercel Blob |
| 前端展示 | 首页 editorial 区域内嵌播放条 |
| 脚本生成引擎 | raven-team（@anthropic-ai/claude-agent-sdk + 本地 Skills） |

---

## 系统架构

### 两服务协作

```
ai-news (Vercel)                    raven-team (Server)
─────────────────                   ────────────────────
morning cron                        Scheduler (poll 30s, max 5 concurrent)
  │                                   │
  ├→ POST /api/v1/tasks ──────────→   ├→ claimTask()
  │   { team: "ai-news-podcast" }     ├→ createSandbox()
  │                                   ├→ query({ prompt, options })
  │                                   │    Director Agent
  │                                   │      ├→ Agent("雷鸣") thread
  │                                   │      ├→ Agent("苏诺") thread
  │                                   │      ├→ Agent("林默") thread
  │                                   │      └→ Agent("reviewer") 质量自审
  │                                   ├→ callback webhook ──┐
  │                                   │                     │
  ←── POST /api/podcast/callback ←────────────────────────-─┘
  │   payload: 完整脚本 JSON
  │
  ├→ 火山引擎 TTS 合成（逐句并发）
  ├→ 音频拼接 → Vercel Blob 上传
  └→ 元数据存入 Upstash Redis
```

### 为什么分两个服务

1. Claude Agent SDK 需要 Claude Code 运行时，Vercel serverless 无此环境
2. 30-40 轮 Agent 对话需 3-5 分钟，超出 Vercel function 60s 限制
3. raven-team 已有调度器、沙盒、hooks、SSE、callback 基础设施

---

## 模块一：Podcast Team YAML

在 raven-team 中定义播客团队：

```yaml
version: v2
metadata:
  name: ai-news-podcast
  description: 每日 AI 新闻播客 — 主编圆桌对谈

spec:
  model: deepseek-chat
  maxTurns: 60
  maxBudgetUsd: 3.0

  tools:
    - builtin://fetch-articles    # MCP tool: 从 article-db 获取文章
    - builtin://submit-script     # MCP tool: 输出最终脚本 JSON

  sandbox:
    type: plain
    setup:
      - raven skills ai-news-editors -a claude-code -y

  agents:
    # 每位编辑的 systemPrompt 为简短角色声明，
    # 完整人设通过 skills 的 SKILL.md 按需加载（progressive disclosure）。
    - role: zhou-yuan
      model: deepseek-chat
      systemPrompt: 你是周远，AI 领域资深编辑，擅长宏观战略分析。以你的视角参与播客对谈。
      skills: [editor-zhou-yuan]
    - role: lin-mo
      model: deepseek-chat
      systemPrompt: 你是林默，AI 领域资深编辑，硬核基础设施极客和开源信仰者。以你的视角参与播客对谈。
      skills: [editor-lin-mo]
    - role: tang-wei
      model: deepseek-chat
      systemPrompt: 你是唐薇，AI 领域资深编辑，产品体验的挑剔鉴赏家。以你的视角参与播客对谈。
      skills: [editor-tang-wei]
    - role: lei-ming
      model: deepseek-chat
      systemPrompt: 你是雷鸣，AI 领域资深编辑，擅长戳破行业泡沫和公关话术。以你的视角参与播客对谈。
      skills: [editor-lei-ming]
    - role: su-nuo
      model: deepseek-chat
      systemPrompt: 你是苏诺，AI 领域资深编辑，学术背景深厚，关注前沿论文和真正的科学进展。以你的视角参与播客对谈。
      skills: [editor-su-nuo]
    - role: fang-yi
      model: deepseek-chat
      systemPrompt: 你是方毅，AI 领域资深编辑，创业圈的观察者，关注融资动态和商业模式。以你的视角参与播客对谈。
      skills: [editor-fang-yi]
    - role: lu-yue
      model: deepseek-chat
      systemPrompt: 你是陆月，AI 领域资深编辑，善用比喻和网络梗让技术新闻变得有趣。以你的视角参与播客对谈。
      skills: [editor-lu-yue]
    - role: reviewer
      model: deepseek-chat
      systemPrompt: |
        你是资深播客制作人，专门审核 AI 新闻播客脚本质量。
        你的评审标准严格但公正。按三个维度评分（0-10）并给出修改建议。
```

---

## 模块二：Director Agent 编排逻辑

Director 是 main agent，system prompt 定义三阶段工作流。

### 阶段一：开局准备

1. 调用 `builtin://fetch-articles` 获取昨晚到今早的高质量文章（含评估数据）
2. 从文章中提炼 3-5 个讨论话题，按重要性排序
3. 根据话题与主编专长匹配度，选出今日 3 位参与者（当值主编自动为主持人）

匹配逻辑基于 Skill Level 1 元数据中的专长关键词：

```
话题偏学术/论文 → 苏诺
话题偏商业/融资 → 方毅、雷鸣
话题偏基础设施/开源 → 林默
话题偏产品体验 → 唐薇
话题偏创业/竞争 → 方毅
话题偏生活/趣味 → 陆月
宏观/复盘 → 周远
```

### 阶段二：对话编排（核心循环）

Director 维护一个 conversation transcript。每轮：

1. 审视当前 transcript + 剩余话题 + 轮次预算
2. 决定：谁发言 + 发言指令（开场/回应/反驳/追问/转场/总结）
3. 调用对应 Editor sub-agent，传入完整 transcript + 当轮指令
4. 收到发言 → 追加到 transcript
5. 重复

**传给 sub-agent 的 prompt 结构：**

```
## 当前对话

[雷鸣] 大家好，今天最大的新闻是 DeepSeek V4 开源了...
[苏诺] 我仔细看了他们的技术报告，有几个点值得注意...
[林默] 但是他们的 benchmark 选择很有问题...

## 导演指令

苏诺，林默质疑了 benchmark 的选择，请从论文角度回应他的质疑，
并补充你认为真正有价值的技术突破在哪里。回应控制在 3-4 句话。
```

**轮次预算：**

| 阶段 | 轮次 | 占比 |
|------|------|------|
| 开场寒暄 | 2-3 | ~8% |
| 话题 1（重磅） | 8-10 | ~28% |
| 话题 2 | 6-8 | ~22% |
| 话题 3 | 6-8 | ~22% |
| 话题 4-5（快评） | 3-4 | ~12% |
| 收尾展望 | 2-3 | ~8% |
| **合计** | **~33** | 100% |

总预算 35 轮，28 轮时开始收尾。

### 阶段三：质量自审

对话结束后，Director 调用 `reviewer` sub-agent 审核完整脚本。

---

## 模块三：Editor Skills

每位主编作为一个 Skill 包，通过 `sandbox.setup` 安装到沙盒。

### 文件结构

```
ai-news-editors/
├── editor-zhou-yuan/
│   └── SKILL.md
├── editor-lin-mo/
│   ├── SKILL.md
│   └── DEBATE_PATTERNS.md
├── editor-tang-wei/
│   └── SKILL.md
├── editor-lei-ming/
│   ├── SKILL.md
│   └── CATCHPHRASES.md
├── editor-su-nuo/
│   ├── SKILL.md
│   └── PAPER_ANALYSIS.md
├── editor-fang-yi/
│   └── SKILL.md
├── editor-lu-yue/
│   └── SKILL.md
└── _shared/
    └── PODCAST_FORMAT.md
```

### Progressive Disclosure

| 层级 | 内容 | 加载时机 |
|------|------|---------|
| Level 1 | name + description（专长关键词） | Session 启动时全部加载（~100 tokens/位） |
| Level 2 | SKILL.md 完整人设（人格、说话风格、争论模式、互动关系） | 该主编首次发言时 |
| Level 3 | 附加资料（标志性表达、论文分析框架等） | 对话需要更鲜明风格时按需读取 |

### SKILL.md 示例（雷鸣）

```markdown
---
name: editor-lei-ming
description: 雷鸣，AI 商业辣评主编。擅长戳破行业泡沫、拆穿公关话术。当播客需要雷鸣发言时激活。
---

# 雷鸣 - AI 商业辣评

## 核心人格
- 毒舌但逻辑严密，吐槽一针见血
- 对"重新定义""颠覆""all-in"过敏
- 不是为了毒舌而毒舌，真正在乎行业价值
- 偶尔用反讽和夸张，但底层分析扎实

## 说话风格
- 句子短促有力，喜欢反问
- 经常用"说白了""本质上""你信吗"
- 会用具体数字拆解商业逻辑
- 对同伴的观点会直接说"我不同意"，然后给出理由

## 争论模式
- 遇到技术吹嘘 → 追问商业模式和变现路径
- 遇到融资新闻 → 拆解估值合理性
- 遇到苏诺的学术观点 → 从产业落地角度挑战
- 遇到林默的技术细节 → 追问"所以用户感知到了吗"

## 与其他主编的互动
- 和苏诺：经典"商业 vs 学术"对立，但互相尊重
- 和林默：会认可技术判断，但追问商业价值
- 和唐薇：偶尔联手吐槽花哨 demo
- 和方毅：在融资判断上有共同语言

## 发言长度
- 普通回应：2-3 句
- 深度分析：3-4 句，带数据或案例
- 吐槽：1-2 句，短而有力
```

---

## 模块四：质量自审循环

### Reviewer Sub-agent

独立评审角色，不参与对话生成，只负责评分和建议。

### 评分维度

| 维度 | 通过线 | 评判标准 |
|------|--------|---------|
| 技术准确性 | >= 7/10 | 文章内容理解无误，技术概念表述正确，不过度解读 |
| 观点深度 | >= 7/10 | 不是复述文章，有跨文章关联、独到分析、产业判断 |
| 对谈自然度 | >= 7/10 | 有真实互动（回应、反驳、追问），不像各说各话 |

### 审核流程

```
对话完成 → Director 调用 reviewer
  │
  ├→ reviewer 输出:
  │   {
  │     "technical_accuracy": { "score": 8, "issues": [] },
  │     "insight_depth": { "score": 6, "issues": ["话题2讨论浮于表面"] },
  │     "conversation_naturalness": { "score": 7, "issues": [] },
  │     "overall_pass": false,
  │     "revision_suggestions": [
  │       { "segment": "topic_2", "action": "让苏诺深入分析论文方法论" }
  │     ]
  │   }
  │
  ├→ 不通过：Director 根据建议调用特定编辑修改段落（局部修补，非全部重来）
  ├→ 再次调用 reviewer 审核
  └→ 最多 3 轮迭代，通过后 → builtin://submit-script 输出最终脚本
```

---

## 模块五：TTS 合成管线

脚本生成完成后，ai-news 端处理语音合成。

### 脚本输出格式

```json
{
  "date": "2026-04-11",
  "host": { "name": "雷鸣", "role": "lei-ming" },
  "guests": [
    { "name": "苏诺", "role": "su-nuo" },
    { "name": "林默", "role": "lin-mo" }
  ],
  "topics": [
    { "title": "DeepSeek V4 开源冲击波", "start_turn": 4 },
    { "title": "Agent SDK 路线之争", "start_turn": 15 }
  ],
  "dialogue": [
    { "speaker": "雷鸣", "text": "各位好，今天有个事儿我不吐不快...", "turn": 1 },
    { "speaker": "苏诺", "text": "我仔细看了他们的技术报告...", "turn": 2 },
    ...
  ],
  "review_scores": { "accuracy": 8, "depth": 8, "naturalness": 7 }
}
```

### 处理流程

1. **声音分配** — 每位主编绑定固定的火山引擎音色 ID（`config/editors/_index.yaml`）
2. **逐句合成** — 并发调用火山引擎 TTS API（5 路并发，避免限流），每句 → 一个 mp3 片段
3. **音频拼接** — 句间 300-500ms 静音，话题切换处 800ms 静音，合并为完整 mp3
4. **上传** — Vercel Blob，路径 `podcasts/{date}.mp3`，返回 CDN URL
5. **元数据** — 存入 Upstash Redis，key `podcast:daily:{date}`

### 火山引擎 TTS 集成

- API：`POST https://openspeech.bytedance.com/api/v1/tts`
- 认证：`VOLCENGINE_TTS_APP_ID` + `VOLCENGINE_TTS_ACCESS_TOKEN`
- 每位主编绑定不同 `voice_type`（音色 ID）
- 输出格式：mp3，采样率 24000Hz
- 预估成本：每期 ~2600 字，极低

---

## 模块六：前端展示

### 融合方案：内嵌播放条

播客播放器嵌入现有 editorial 区域，与主编日报深度融合。

### 改动点

1. **byline 扩展** — 在现有 `editorial-byline` 后追加嘉宾信息：
   ```
   [晨报] 主编 雷鸣 AI 商业辣评 · 圆桌 苏诺 林默
   ```

2. **播放条** — 在 `.editorial-body` 和 `.editorial-tags` 之间插入：
   ```
   ┌─────────────────────────────────────────┐
   │  [▶]  收听圆桌讨论  18:32              │
   │       ▬▬▬▬▬▬▬▬▬▬▬▬▬▬▬░░░░░░░░░░░░░    │
   └─────────────────────────────────────────┘
   ```
   - 圆角矩形，浅灰背景 + 细边框
   - 左侧圆形播放/暂停按钮（accent 色）
   - 标题 + 时长 + 进度条
   - 点击进度条可拖拽跳转

3. **无播客时** — 播放条不渲染，editorial 区域保持现有样式

### 数据获取

- 新增 API：`GET /api/podcast/today` → 返回 `{ url, host, guests, topics, duration, scores }` 或 `null`
- 数据源：Upstash Redis `podcast:daily:{date}`
- 前端 `useEffect` 并行加载 editorial + podcast 数据

### 音频播放

- 使用原生 HTML `<audio>` 元素
- React state 管理播放状态（playing/paused/currentTime/duration）
- 进度条用 `<input type="range">` + CSS 自定义样式
- 无需第三方音频库

---

## 新增文件清单

### raven-team 侧

| 文件 | 用途 |
|------|------|
| `src/builtin/ai-news-podcast.yaml` | Podcast Team YAML 定义 |
| `ai-news-editors/editor-*.SKILL.md` (×7) | 7 位主编 persona Skill |
| `ai-news-editors/_shared/PODCAST_FORMAT.md` | 播客对话格式规范 |
| `src/builtin/mcp-server.ts` (扩展) | 新增 `fetch-articles` + `submit-script` MCP tools |

### ai-news 侧

| 文件 | 用途 |
|------|------|
| `app/api/podcast/callback/route.ts` | 接收 raven-team 回调，触发 TTS |
| `app/api/podcast/today/route.ts` | 前端获取今日播客数据 |
| `lib/tts/volcengine-client.ts` | 火山引擎 TTS API 封装 |
| `lib/tts/audio-stitcher.ts` | 音频片段拼接 |
| `lib/tts/podcast-producer.ts` | 编排 TTS 合成 + 拼接 + 上传流程 |
| `config/editors/_index.yaml` | 主编元数据（含 voice_id 映射） |
| `app/components/podcast-player.tsx` | 播放器 UI 组件 |
| `app/globals.css` (扩展) | 播放条样式 |

---

## 环境变量

### raven-team

无新增（已有 `ANTHROPIC_API_KEY`、调度器配置）。

### ai-news

| 变量 | 用途 |
|------|------|
| `VOLCENGINE_TTS_APP_ID` | 火山引擎应用 ID |
| `VOLCENGINE_TTS_ACCESS_TOKEN` | 火山引擎 access token |
| `RAVEN_TEAM_BASE_URL` | raven-team 服务地址 |
| `RAVEN_TEAM_API_TOKEN` | raven-team API 认证 |
| `PODCAST_CALLBACK_SECRET` | 回调请求签名密钥 |

---

## 成本预估（每期）

| 项目 | 预估 |
|------|------|
| LLM（脚本生成，~45 次 DeepSeek 调用） | ¥0.5-1.5 |
| LLM（质量审核，~3 次调用） | ¥0.1-0.3 |
| 火山引擎 TTS（~2600 字） | ¥0.05-0.1 |
| Vercel Blob 存储（~15-20MB/期） | 可忽略 |
| **合计** | **¥0.7-2.0/期** |
