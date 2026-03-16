import type { ExtractionTask, ExtractedResource, ExtractionMetadata } from "@/lib/domain/url-extraction-models";
import { fetchJson } from "@/lib/infra/http";

/**
 * Extract Twitter/X content via RSSHub.
 * Expects RSSHUB_BASE_URL to be set (e.g. https://rsshub.example.com).
 */
export async function extractTwitterContent(
  url: string,
  taskId: string,
): Promise<{ resources: ExtractedResource[]; metadata: ExtractionMetadata }> {
  const rsshubBase = String(process.env.RSSHUB_BASE_URL || "").trim().replace(/\/$/, "");
  if (!rsshubBase) {
    throw new Error("RSSHUB_BASE_URL is not configured");
  }

  const tweetInfo = parseTweetUrl(url);
  if (!tweetInfo) {
    throw new Error(`Cannot parse tweet URL: ${url}`);
  }

  // Fetch user timeline via RSSHub and find matching tweet
  const feedUrl = `${rsshubBase}/twitter/user/${encodeURIComponent(tweetInfo.username)}`;
  const rssXml = await fetchRssText(feedUrl);

  const resources: ExtractedResource[] = [];
  const metadata: ExtractionMetadata = {
    title: "",
    description: "",
    author: tweetInfo.username,
    platform_id: tweetInfo.tweetId,
    tags: [],
  };

  // Parse RSS items to find the matching tweet
  const items = parseRssItems(rssXml);
  const matchingItem = items.find(
    (item) => item.link.includes(tweetInfo.tweetId) || item.guid?.includes(tweetInfo.tweetId),
  );

  if (matchingItem) {
    metadata.title = matchingItem.title || `@${tweetInfo.username} tweet`;
    metadata.description = stripHtml(matchingItem.description);
    metadata.published_at = matchingItem.pubDate;

    // Extract text content
    resources.push({
      type: "text",
      url: url,
      filename: "tweet.txt",
      size_bytes: metadata.description.length,
      mime_type: "text/plain",
    });

    // Extract images from description HTML
    const imageUrls = extractImageUrls(matchingItem.description);
    for (const imageUrl of imageUrls) {
      resources.push({
        type: "image",
        url: imageUrl,
        filename: `image_${resources.length}.jpg`,
        size_bytes: 0,
        mime_type: "image/jpeg",
      });
    }
  } else {
    throw new Error("无法通过 RSSHub 获取推文内容。可能推文较旧或 RSSHub 缓存已过期。");
  }

  return { resources, metadata };
}

interface TweetInfo {
  username: string;
  tweetId: string;
}

function parseTweetUrl(url: string): TweetInfo | null {
  try {
    const parsed = new URL(url);
    // Patterns: twitter.com/user/status/123, x.com/user/status/123
    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length >= 3 && parts[1] === "status") {
      return { username: parts[0], tweetId: parts[2] };
    }
    // Just a user profile
    if (parts.length >= 1) {
      return { username: parts[0], tweetId: "" };
    }
    return null;
  } catch {
    return null;
  }
}

async function fetchRssText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/rss+xml, application/xml, text/xml" },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`RSSHub fetch failed: ${response.status}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

interface RssItem {
  title: string;
  link: string;
  guid?: string;
  description: string;
  pubDate?: string;
}

function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const itemRe = /<item>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = itemRe.exec(xml)) !== null) {
    const content = match[1] || "";
    items.push({
      title: extractTag(content, "title"),
      link: extractTag(content, "link"),
      guid: extractTag(content, "guid"),
      description: extractTag(content, "description"),
      pubDate: extractTag(content, "pubDate"),
    });
  }
  return items;
}

function extractTag(xml: string, tagName: string): string {
  const re = new RegExp(`<${tagName}[^>]*>\\s*(?:<!\\[CDATA\\[)?([\\s\\S]*?)(?:\\]\\]>)?\\s*<\\/${tagName}>`, "i");
  const match = re.exec(xml);
  return match ? String(match[1] || "").trim() : "";
}

function stripHtml(html: string): string {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function extractImageUrls(html: string): string[] {
  const urls: string[] = [];
  const imgRe = /<img\b[^>]*src\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let match: RegExpExecArray | null = null;
  while ((match = imgRe.exec(html)) !== null) {
    const src = String(match[1] || "").trim();
    if (src && src.startsWith("http")) {
      urls.push(src);
    }
  }
  return urls;
}
