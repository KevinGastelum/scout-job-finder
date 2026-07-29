CREATE VIRTUAL TABLE jobs_fts USING fts5 (
  title,
  company,
  description,
  content = 'jobs',
  content_rowid = 'id',
  tokenize = 'porter unicode61'
);

INSERT INTO jobs_fts (rowid, title, company, description)
SELECT id, title, company, description FROM jobs;

CREATE TRIGGER jobs_fts_insert AFTER INSERT ON jobs BEGIN
  INSERT INTO jobs_fts (rowid, title, company, description)
  VALUES (new.id, new.title, new.company, new.description);
END;

CREATE TRIGGER jobs_fts_delete AFTER DELETE ON jobs BEGIN
  INSERT INTO jobs_fts (jobs_fts, rowid, title, company, description)
  VALUES ('delete', old.id, old.title, old.company, old.description);
END;

CREATE TRIGGER jobs_fts_update AFTER UPDATE ON jobs BEGIN
  INSERT INTO jobs_fts (jobs_fts, rowid, title, company, description)
  VALUES ('delete', old.id, old.title, old.company, old.description);
  INSERT INTO jobs_fts (rowid, title, company, description)
  VALUES (new.id, new.title, new.company, new.description);
END;
