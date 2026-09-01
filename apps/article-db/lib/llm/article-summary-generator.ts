import { DeepSeekClient } from "@/lib/llm/deepseek-client";

const SUMMARY_PROMPT_VERSION = "v1";

const SYSTEM_PROMPT = `你是一位专业的文章分析专家。请根据提供的文章内容，生成结构化的 Markdown 摘要。

严格按照以下格式输出：

## 一句话核心思想
用一句话总结整篇文章最核心的观点或结论。必须精炼，直击要害。

## 核心论点
以有序列表的形式，列出支撑核心思想的 3-5 个主要论点。
每个论点后，用一小段话（不超过 50 字）简要说明其论证过程或关键证据。

## 关键信息与数据
以无序列表的形式，提取文章中所有关键的、作为证据支撑的数据、事实或案例。
如果没有，请明确指出"本文未提供具体的量化数据或案例。"

## 结论
总结文章得出的最终结论或提出的最终解决方案。

## 关键术语解释
列出并解释文章中出现的、可能对普通读者造成理解障碍的核心术语。
如果没有，请明确指出"本文无复杂的专业术语。"

## 标签
基于文章内容生成 3-6 个高质量标签，用空格分隔。

核心原则：
- 绝对忠实原文，严禁任何形式的个人解读、评论或信息增删
- 所有内容必须直接源于原文
- 严格按照上述格式输出，不得更改标题或顺序`;

export interface ArticleSummaryInput {
  articleId: string;
  title: string;
  url: string;
  contentFullText: string;
  contentText: string;
  summaryRaw: string;
  leadParagraph: string;
}

export interface ArticleSummaryResult {
  markdown: string;
  modelName: string;
  promptVersion: string;
}

export async function generateArticleSummary(input: ArticleSummaryInput): Promise<ArticleSummaryResult> {
  const client = new DeepSeekClient({ timeoutSeconds: 90 });

  const contentBody = buildContentBody(input);
  if (!contentBody) {
    throw new Error("No content available for summarization");
  }

  const userMessage = `# ${input.title}\n\n来源: ${input.url}\n\n${contentBody}`;

  const raw = await client.chat(
    [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    0.2,
  );

  const markdown = cleanMarkdownOutput(raw);

  const markdownWithSource = appendSource(markdown, input.url);

  return {
    markdown: markdownWithSource,
    modelName: client.model,
    promptVersion: SUMMARY_PROMPT_VERSION,
  };
}

function buildContentBody(input: ArticleSummaryInput): string {
  if (input.contentFullText && input.contentFullText.length > 50) {
    const truncated = input.contentFullText.slice(0, 30_000);
    return truncated;
  }

  if (input.contentText && input.contentText.length > 50) {
    return input.contentText.slice(0, 30_000);
  }

  const parts: string[] = [];
  if (input.summaryRaw) parts.push(input.summaryRaw);
  if (input.leadParagraph) parts.push(input.leadParagraph);

  const combined = parts.join("\n\n").trim();
  return combined.length > 20 ? combined : "";
}

function cleanMarkdownOutput(raw: string): string {
  let text = String(raw || "").trim();
  if (text.startsWith("```markdown")) {
    text = text.replace(/^```markdown\s*/i, "").replace(/\s*```$/, "").trim();
  } else if (text.startsWith("```")) {
    text = text.replace(/^```\s*/, "").replace(/\s*```$/, "").trim();
  }
  return text;
}

function appendSource(markdown: string, url: string): string {
  if (markdown.includes("## 来源")) {
    return markdown;
  }
  return `${markdown}\n\n## 来源\n\n[原文链接](${url})`;
}
