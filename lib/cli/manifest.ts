export type CliOptionDef = {
  name: string;
  short?: string;
  description: string;
  required: boolean;
  type: "string" | "boolean" | "number";
};

export type CliArgDef = {
  name: string;
  description: string;
  required: boolean;
};

export type CliCommandDef = {
  path: string[];
  description: string;
  api: {
    method: string;
    path: string;
  };
  arguments?: CliArgDef[];
  options?: CliOptionDef[];
  outputHint?: "json" | "table";
};

export type CliManifest = {
  version: string;
  commands: CliCommandDef[];
};

export function buildCliManifest(): CliManifest {
  return {
    version: "2026-03-11.1",
    commands: [
      {
        path: ["ingest", "run"],
        description: "Trigger the ingestion pipeline",
        api: { method: "GET", path: "/api/v1/ingestion/run" },
        options: [
          {
            name: "date",
            short: "d",
            description: "Target date (YYYY-MM-DD)",
            required: false,
            type: "string",
          },
          {
            name: "tz",
            description: "Timezone (default: Asia/Shanghai)",
            required: false,
            type: "string",
          },
          {
            name: "skip_jitter",
            description: "Skip random jitter delay",
            required: false,
            type: "boolean",
          },
        ],
      },
      {
        path: ["extract", "url"],
        description: "Submit a URL for content extraction",
        api: { method: "POST", path: "/api/v1/extract-url" },
        options: [
          {
            name: "url",
            short: "u",
            description: "URL to extract",
            required: true,
            type: "string",
          },
          {
            name: "blob_ttl_hours",
            description: "Blob TTL in hours (1-168)",
            required: false,
            type: "number",
          },
        ],
      },
      {
        path: ["extract", "status"],
        description: "Check extraction task status",
        api: { method: "GET", path: "/api/v1/extract-url/:task_id" },
        arguments: [{ name: "task_id", description: "Extraction task ID", required: true }],
      },
      {
        path: ["extract", "list"],
        description: "List pending extraction tasks",
        api: { method: "GET", path: "/api/v1/extract-url" },
        options: [
          {
            name: "limit",
            short: "l",
            description: "Max results",
            required: false,
            type: "number",
          },
        ],
      },
      {
        path: ["articles", "list"],
        description: "List high-quality articles for a date",
        api: { method: "GET", path: "/api/v1/articles/high-quality" },
        options: [
          {
            name: "date",
            short: "d",
            description: "Date (YYYY-MM-DD, default: today)",
            required: false,
            type: "string",
          },
          {
            name: "limit",
            short: "l",
            description: "Max results (1-200, default: 50)",
            required: false,
            type: "number",
          },
          { name: "offset", description: "Offset for pagination", required: false, type: "number" },
          {
            name: "quality_tier",
            description: "Quality tier: high|general|all",
            required: false,
            type: "string",
          },
          {
            name: "source_channel",
            description: "Filter by source channel",
            required: false,
            type: "string",
          },
          {
            name: "tag_group",
            description: "Filter by tag group",
            required: false,
            type: "string",
          },
          { name: "tag", description: "Filter by tag", required: false, type: "string" },
        ],
      },
      {
        path: ["articles", "get"],
        description: "Get article detail by ID",
        api: { method: "GET", path: "/api/v1/articles/:article_id" },
        arguments: [{ name: "article_id", description: "Article ID", required: true }],
      },
      {
        path: ["articles", "summary"],
        description: "Get or generate article summary",
        api: { method: "GET", path: "/api/v1/articles/:article_id/summary" },
        arguments: [{ name: "article_id", description: "Article ID", required: true }],
      },
      {
        path: ["articles", "archive"],
        description: "List archived articles with filters",
        api: { method: "GET", path: "/api/v1/articles/archive-list" },
        options: [
          { name: "from", description: "Start date (YYYY-MM-DD)", required: false, type: "string" },
          { name: "to", description: "End date (YYYY-MM-DD)", required: false, type: "string" },
          {
            name: "quality_tier",
            description: "Quality tier: high|general|all",
            required: false,
            type: "string",
          },
          {
            name: "source_channel",
            description: "Filter by source channel",
            required: false,
            type: "string",
          },
          {
            name: "source_id",
            description: "Filter by source ID",
            required: false,
            type: "string",
          },
          { name: "q", description: "Search query", required: false, type: "string" },
          {
            name: "limit",
            short: "l",
            description: "Max results (1-200)",
            required: false,
            type: "number",
          },
          { name: "offset", description: "Offset for pagination", required: false, type: "number" },
        ],
      },
      {
        path: ["sources", "list"],
        description: "List all configured data sources",
        api: { method: "GET", path: "/api/cli/sources" },
      },
      {
        path: ["runs", "get"],
        description: "Get ingestion run details for a date",
        api: { method: "GET", path: "/api/v1/runs/:date" },
        arguments: [{ name: "date", description: "Run date (YYYY-MM-DD)", required: true }],
      },
    ],
  };
}
