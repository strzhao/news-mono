CREATE TABLE IF NOT EXISTS article_summaries (
  article_id TEXT PRIMARY KEY REFERENCES articles(id) ON DELETE CASCADE,
  summary_markdown TEXT NOT NULL DEFAULT '',
  model_name TEXT NOT NULL DEFAULT '',
  prompt_version TEXT NOT NULL DEFAULT 'v1',
  status TEXT NOT NULL DEFAULT 'pending',
  error_message TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT chk_article_summary_status CHECK (status IN ('pending', 'generating', 'completed', 'failed'))
);

CREATE INDEX IF NOT EXISTS idx_article_summaries_status ON article_summaries (status);
