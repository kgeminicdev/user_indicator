CREATE TABLE IF NOT EXISTS records (
  id     SERIAL PRIMARY KEY,
  name   TEXT NOT NULL,
  email  TEXT,
  link   TEXT,
  other  TEXT
);

CREATE TABLE IF NOT EXISTS todo (
  id             SERIAL PRIMARY KEY,
  braintrust_id  INTEGER NOT NULL UNIQUE,
  name           TEXT,
  github_url     TEXT,
  linkedin_url   TEXT,
  derived_email  TEXT,
  status         TEXT NOT NULL DEFAULT 'pending',
  created_at     TIMESTAMP NOT NULL DEFAULT now()
);
