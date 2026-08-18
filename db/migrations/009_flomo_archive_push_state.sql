-- Add flomo archive push state tables used by the consumer service.

CREATE TABLE IF NOT EXISTS flomo_archive_push_batches (
  batch_key TEXT PRIMARY KEY,
  source_date DATE NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  article_ids_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  payload_content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  sent_at TIMESTAMPTZ,
  last_error TEXT NOT NULL DEFAULT '',
  CONSTRAINT chk_flomo_archive_push_batches_status
    CHECK (status IN ('pending', 'sent', 'failed'))
);

CREATE TABLE IF NOT EXISTS flomo_archive_article_consumption (
  article_id TEXT PRIMARY KEY,
  source_date DATE NOT NULL,
  batch_key TEXT NOT NULL REFERENCES flomo_archive_push_batches(batch_key)
    ON UPDATE CASCADE
    ON DELETE RESTRICT,
  consumed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_flomo_archive_push_batches_status_created
  ON flomo_archive_push_batches (status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_flomo_archive_push_batches_source_date
  ON flomo_archive_push_batches (source_date DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_flomo_archive_article_consumption_source_date
  ON flomo_archive_article_consumption (source_date DESC, consumed_at DESC);
