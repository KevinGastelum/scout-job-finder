CREATE TABLE raw_postings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  source TEXT NOT NULL,
  source_native_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL
);

CREATE INDEX idx_raw_postings_source ON raw_postings (source, source_native_id);

CREATE TABLE jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_posting_id INTEGER NOT NULL REFERENCES raw_postings (id),
  canonical_id TEXT NOT NULL,
  source TEXT NOT NULL,
  source_native_id TEXT NOT NULL,
  company TEXT NOT NULL,
  company_normalized TEXT NOT NULL,
  title TEXT NOT NULL,
  title_family TEXT,
  seniority TEXT,
  variant_markers TEXT NOT NULL DEFAULT '[]',
  location TEXT,
  location_key TEXT NOT NULL DEFAULT '',
  remote INTEGER NOT NULL DEFAULT 0,
  salary_text TEXT,
  description TEXT NOT NULL,
  description_hash TEXT NOT NULL,
  url TEXT NOT NULL,
  canonical_url TEXT NOT NULL,
  posted_at TEXT,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  missed_runs INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  UNIQUE (source, source_native_id)
);

CREATE INDEX idx_jobs_canonical ON jobs (canonical_id);

CREATE INDEX idx_jobs_canonical_url ON jobs (canonical_url);

CREATE INDEX idx_jobs_status ON jobs (status);

CREATE TABLE extractions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs (id),
  description_hash TEXT NOT NULL,
  prompt_version TEXT NOT NULL,
  skills TEXT NOT NULL DEFAULT '[]',
  responsibilities TEXT NOT NULL DEFAULT '[]',
  must_haves TEXT NOT NULL DEFAULT '[]',
  nice_to_haves TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE (description_hash, prompt_version)
);

CREATE TABLE scores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL REFERENCES jobs (id),
  description_hash TEXT NOT NULL,
  rubric_version TEXT NOT NULL,
  hard_filter_pass INTEGER NOT NULL DEFAULT 0,
  hard_filter_reasons TEXT NOT NULL DEFAULT '[]',
  retrieval_score REAL NOT NULL DEFAULT 0,
  recall_paths TEXT NOT NULL DEFAULT '[]',
  rubric_score REAL,
  dimensions TEXT,
  uncertainty TEXT,
  rationale TEXT,
  prompt_version TEXT,
  model_id TEXT,
  scored_at TEXT NOT NULL,
  UNIQUE (job_id, rubric_version)
);

CREATE INDEX idx_scores_cache ON scores (description_hash, rubric_version);

CREATE TABLE applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id INTEGER NOT NULL UNIQUE REFERENCES jobs (id),
  status TEXT NOT NULL,
  channel TEXT,
  applied_at TEXT,
  artifacts_path TEXT,
  submission_record TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  status TEXT NOT NULL,
  stats TEXT NOT NULL DEFAULT '[]',
  error TEXT
);
