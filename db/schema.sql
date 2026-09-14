CREATE TABLE IF NOT EXISTS records (
  id               SERIAL PRIMARY KEY,
  name             TEXT NOT NULL,
  email            TEXT,
  link             TEXT,
  other            TEXT
);

-- Braintrust ID-range scan queue (the Braintrust tab) — named apart from
-- todo_entries (the unified "To Do" tab) to avoid confusion between the two.
CREATE TABLE IF NOT EXISTS scanned_braintrust (
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

ALTER TABLE scanned_braintrust ADD COLUMN IF NOT EXISTS linkedin_verified BOOLEAN;
ALTER TABLE scanned_braintrust ADD COLUMN IF NOT EXISTS avatar_url TEXT;

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

-- Tracks which Vee lookup proxy IPs are known to have exhausted their daily
-- free-tier credits, so fetchVeeProfile can skip them without a live 403
-- round-trip, and the skip-list survives server restarts.
CREATE TABLE IF NOT EXISTS vee_proxy_ips (
  ip                   TEXT PRIMARY KEY,
  exhausted_until      TIMESTAMP,
  credits_used_today   INTEGER NOT NULL DEFAULT 0,
  credits_used_date    DATE,
  updated_at           TIMESTAMP NOT NULL DEFAULT now()
);

ALTER TABLE vee_proxy_ips ADD COLUMN IF NOT EXISTS credits_used_today INTEGER NOT NULL DEFAULT 0;
ALTER TABLE vee_proxy_ips ADD COLUMN IF NOT EXISTS credits_used_date DATE;

-- Caches fetchVeeProfile results by LinkedIn identifier so the same person
-- is never fetched from Vee twice within the freshness window — e.g.
-- viewing a candidate's profile and later fetching their To Do content
-- would otherwise each cost a separate live (credit-spending) request for
-- the same profile.
CREATE TABLE IF NOT EXISTS vee_profile_cache (
  identifier   TEXT PRIMARY KEY,
  data         JSONB NOT NULL,
  fetched_at   TIMESTAMP NOT NULL DEFAULT now()
);

-- Persisted HackerRank leaderboard matches (contact-info found), deduped by
-- hacker username — a later scan skips anyone already here instead of
-- re-fetching and re-verifying them.
CREATE TABLE IF NOT EXISTS hackerrank_matches (
  id                    SERIAL PRIMARY KEY,
  hacker                TEXT NOT NULL UNIQUE,
  hacker_id             INTEGER,
  name                  TEXT,
  website               TEXT,
  linkedin_url          TEXT,
  github_url            TEXT,
  resume_url            TEXT,
  rank                  INTEGER,
  score                 NUMERIC,
  skill                 TEXT,
  already_in_records    BOOLEAN NOT NULL DEFAULT false,
  added_to_todo         BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMP NOT NULL DEFAULT now()
);
ALTER TABLE hackerrank_matches ADD COLUMN IF NOT EXISTS ignored BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE hackerrank_matches ADD COLUMN IF NOT EXISTS avatar_url TEXT;

-- Checkpointed HackerRank scan progress, same resumable pattern as
-- github_us_searches — a scan across many leaderboard pages can be
-- interrupted and picked back up from current_page.
-- The unified staging queue candidates from GitHub, Braintrust, and
-- HackerRank all funnel into before a final decision (Applied moves them to
-- records + working_history; Remove just discards the entry).
CREATE TABLE IF NOT EXISTS todo_entries (
  id           SERIAL PRIMARY KEY,
  name         TEXT,
  email        TEXT,
  link         TEXT NOT NULL,
  content      TEXT,
  source       TEXT,
  created_at   TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS hackerrank_scans (
  id                  SERIAL PRIMARY KEY,
  skill               TEXT NOT NULL,
  start_page          INTEGER NOT NULL,
  end_page            INTEGER NOT NULL,
  current_page        INTEGER NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'in_progress',
  scanned             INTEGER NOT NULL DEFAULT 0,
  matched             INTEGER NOT NULL DEFAULT 0,
  already_in_db       INTEGER NOT NULL DEFAULT 0,
  already_in_records  INTEGER NOT NULL DEFAULT 0,
  error_message       TEXT,
  created_at          TIMESTAMP NOT NULL DEFAULT now(),
  updated_at          TIMESTAMP NOT NULL DEFAULT now()
);
