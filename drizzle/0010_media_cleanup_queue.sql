CREATE TABLE IF NOT EXISTS media_cleanup (
  media_key TEXT PRIMARY KEY NOT NULL,
  created INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS media_cleanup_created_idx ON media_cleanup(created);
