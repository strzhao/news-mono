export type ExtractionPlatform = "youtube" | "bilibili" | "twitter" | "xiaohongshu" | "instagram" | "wechat" | "webpage" | "unknown";

export type ExtractionStatus = "pending" | "processing" | "completed" | "failed";

export type ResourceType = "video" | "audio" | "subtitle" | "thumbnail" | "image" | "text" | "metadata";

export interface ExtractedResource {
  type: ResourceType;
  url: string;
  filename: string;
  size_bytes: number;
  mime_type: string;
  language?: string;
  format?: string;
  expires_at?: string;
}

export interface ExtractionMetadata {
  title: string;
  description: string;
  author: string;
  duration?: number;
  published_at?: string;
  platform_id?: string;
  tags?: string[];
}

export interface ExtractionTask {
  task_id: string;
  url: string;
  platform: ExtractionPlatform;
  status: ExtractionStatus;
  user_id: string;
  resources: ExtractedResource[];
  metadata: ExtractionMetadata;
  created_at: string;
  completed_at?: string;
  error_message?: string;
  blob_ttl_hours: number;
  /** AI-generated summary markdown (populated when ai_summary was requested). */
  ai_summary?: string;
}

export const DEFAULT_BLOB_TTL_HOURS = 72;
