CREATE TABLE hn_extractions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  comment_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  postings TEXT NOT NULL DEFAULT '[]',
  extracted_at TEXT NOT NULL,
  UNIQUE (comment_id, prompt_version)
);

CREATE INDEX idx_hn_extractions_thread ON hn_extractions (thread_id, prompt_version);
