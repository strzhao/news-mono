import type { ExtractionPlatform } from "./url-extraction-models";

const PLATFORM_RULES: Array<{ hosts: string[]; platform: ExtractionPlatform }> = [
  { hosts: ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be", "music.youtube.com"], platform: "youtube" },
  { hosts: ["bilibili.com", "www.bilibili.com", "m.bilibili.com", "b23.tv"], platform: "bilibili" },
  { hosts: ["twitter.com", "www.twitter.com", "x.com", "www.x.com", "mobile.twitter.com"], platform: "twitter" },
  { hosts: ["xiaohongshu.com", "www.xiaohongshu.com", "xhslink.com"], platform: "xiaohongshu" },
  { hosts: ["instagram.com", "www.instagram.com"], platform: "instagram" },
  { hosts: ["mp.weixin.qq.com"], platform: "wechat" },
];

export function detectPlatform(url: string): ExtractionPlatform {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    for (const rule of PLATFORM_RULES) {
      if (rule.hosts.includes(host)) {
        return rule.platform;
      }
    }
    return "webpage";
  } catch {
    return "unknown";
  }
}

/** Platforms that require the local extraction worker (yt-dlp, etc.). */
export function requiresWorker(platform: ExtractionPlatform): boolean {
  return ["youtube", "bilibili", "xiaohongshu", "instagram"].includes(platform);
}
