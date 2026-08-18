-- Add lookup indexes used by archive list/range queries.

CREATE INDEX IF NOT EXISTS idx_daily_high_quality_article_date
  ON daily_high_quality_articles (article_id, date);

CREATE INDEX IF NOT EXISTS idx_daily_analyzed_article_date
  ON daily_analyzed_articles (article_id, date);
