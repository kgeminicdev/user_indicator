CREATE TABLE IF NOT EXISTS records (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  email            TEXT,
  link             TEXT,
  other            TEXT
);

CREATE TABLE IF NOT EXISTS todo (
  id                  SERIAL PRIMARY KEY,
  braintrust_id       INTEGER NOT NULL UNIQUE,
  name                TEXT,
  github_url          TEXT,
  linkedin_url        TEXT,
  linkedin_verified   BOOLEAN,
  external_profiles   JSONB,
  derived_email       TEXT,
  status              TEXT NOT NULL DEFAULT 'pending',
  hidden              BOOLEAN NOT NULL DEFAULT false,
  created_at          TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE todo ADD COLUMN IF NOT EXISTS linkedin_verified BOOLEAN;

CREATE TABLE IF NOT EXISTS github_us (
  id                    SERIAL PRIMARY KEY,
  name                  TEXT,
  github_link           TEXT NOT NULL UNIQUE,
  email                 TEXT,
  avatar_url            TEXT,
  location              TEXT,
  already_in_records    BOOLEAN NOT NULL DEFAULT false,
  linkedin_url          TEXT,
  linkedin_verified     BOOLEAN,
  applied               BOOLEAN NOT NULL DEFAULT false,
  applied_at            TIMESTAMP,
  ignored               BOOLEAN NOT NULL DEFAULT false,
  score_total           INTEGER,
  score_breakdown       JSONB,
  scored_at             TIMESTAMP,
  account_created_at    DATE,
  last_pushed_at        TIMESTAMP,
  public_repos          INTEGER,
  followers             INTEGER,
  total_stars           INTEGER,
  bio                   TEXT,
  company               TEXT,
  primary_language      TEXT,
  is_likely_authentic   BOOLEAN,
  created_at            TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE github_us ADD COLUMN IF NOT EXISTS linkedin_url TEXT;
ALTER TABLE github_us ADD COLUMN IF NOT EXISTS linkedin_verified BOOLEAN;
ALTER TABLE github_us ADD COLUMN IF NOT EXISTS applied BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE github_us ADD COLUMN IF NOT EXISTS applied_at TIMESTAMP;
ALTER TABLE github_us ADD COLUMN IF NOT EXISTS ignored BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS github_us_searches (
  id                         SERIAL PRIMARY KEY,
  location                   TEXT NOT NULL,
  years                      INTEGER NOT NULL,
  cutoff_date                TEXT NOT NULL,
  status                     TEXT NOT NULL DEFAULT 'in_progress',
  windows                    JSONB,
  current_window             INTEGER NOT NULL DEFAULT 0,
  current_page               INTEGER NOT NULL DEFAULT 0,
  total_count                INTEGER NOT NULL DEFAULT 0,
  already_in_db              INTEGER NOT NULL DEFAULT 0,
  already_in_braintrust      INTEGER NOT NULL DEFAULT 0,
  checked_new                INTEGER NOT NULL DEFAULT 0,
  with_email                 INTEGER NOT NULL DEFAULT 0,
  already_in_records         INTEGER NOT NULL DEFAULT 0,
  incomplete_windows         INTEGER NOT NULL DEFAULT 0,
  require_linkedin           BOOLEAN NOT NULL DEFAULT false,
  require_active_last_year   BOOLEAN NOT NULL DEFAULT false,
  error_message              TEXT,
  created_at                 TIMESTAMP NOT NULL DEFAULT now(),
  updated_at                 TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE github_us_searches ADD COLUMN IF NOT EXISTS already_in_braintrust INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS working_history (
  id              SERIAL PRIMARY KEY,
  email           TEXT,
  linkedin_url    TEXT NOT NULL,
  content         TEXT,
  source          TEXT,
  read_at         TIMESTAMP,
  interviewed_at  TIMESTAMP,
  created_at      TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE working_history ADD COLUMN IF NOT EXISTS source TEXT;
ALTER TABLE working_history ADD COLUMN IF NOT EXISTS read_at TIMESTAMP;
ALTER TABLE working_history ADD COLUMN IF NOT EXISTS interviewed_at TIMESTAMP;
