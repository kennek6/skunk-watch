-- Skunk Watch: D1 schema.
--
-- There is no latitude or longitude column anywhere in this file, and that is
-- the single most important property of the design. Coordinates are snapped to
-- a geohash cell in the Worker and the originals are discarded before anything
-- is written. A breach, a subpoena, or a careless query cannot reveal a street
-- address that was never stored. See SPEC.md non-negotiables 9 to 11.

-- Live tier. Individual reports, deleted after 48 hours by the cron sweep.
CREATE TABLE IF NOT EXISTS reports (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  cell            TEXT    NOT NULL,  -- geohash 7 for sight/roadkill, 6 for smell
  display_cell    TEXT    NOT NULL,  -- geohash 6, the only cell ever drawn
  region          TEXT    NOT NULL,  -- geohash 4, the unit a client requests
  type            TEXT    NOT NULL
    CHECK (type IN ('saw_live', 'smelled_fresh', 'smelled_faint', 'found_roadkill')),
  species         TEXT    NOT NULL DEFAULT 'skunk',
  under_structure INTEGER NOT NULL DEFAULT 0 CHECK (under_structure IN (0, 1)),
  observed_hour   TEXT    NOT NULL,  -- 'YYYY-MM-DDTHH' in UTC, never finer
  observed_at     INTEGER NOT NULL,  -- when it was SEEN, which drives the live tier
  device_key      TEXT    NOT NULL,  -- random per install, for rate limits only
  created_at      INTEGER NOT NULL   -- unix seconds, drives the deletion sweep only
);
CREATE INDEX IF NOT EXISTS idx_reports_region_observed ON reports (region, observed_at);
CREATE INDEX IF NOT EXISTS idx_reports_region_created ON reports (region, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_device_created ON reports (device_key, created_at);
CREATE INDEX IF NOT EXISTS idx_reports_created ON reports (created_at);

-- Recent tier. Per cell per day, kept 30 days. Answers "3 sightings within
-- 500 m in the last two weeks", which is more useful to a dog owner than any
-- single pin.
CREATE TABLE IF NOT EXISTS recent (
  display_cell TEXT    NOT NULL,
  region       TEXT    NOT NULL,
  day          TEXT    NOT NULL,  -- 'YYYY-MM-DD' in UTC
  type         TEXT    NOT NULL,
  n            INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (display_cell, day, type)
);
CREATE INDEX IF NOT EXISTS idx_recent_region_day ON recent (region, day);

-- Baseline tier. Per cell per ISO week, counts only, kept indefinitely. No
-- timestamp and no device key, so a row is not about an identifiable person
-- and there is nothing here to request the deletion of.
CREATE TABLE IF NOT EXISTS baseline (
  display_cell TEXT    NOT NULL,
  region       TEXT    NOT NULL,
  week         TEXT    NOT NULL,  -- 'YYYY-Www'
  n            INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (display_cell, week)
);
CREATE INDEX IF NOT EXISTS idx_baseline_region ON baseline (region);

-- A carcass smells for days. Known roadkill in a cell explains the smell
-- reports that follow, so those are kept out of the live tier for a week
-- instead of being read as a fresh animal.
CREATE TABLE IF NOT EXISTS roadkill (
  display_cell TEXT    PRIMARY KEY,
  region       TEXT    NOT NULL,
  until        INTEGER NOT NULL  -- unix seconds
);
CREATE INDEX IF NOT EXISTS idx_roadkill_region ON roadkill (region, until);
-- Historic occurrence records from GBIF: museum specimens, iNaturalist
-- observations, roadkill surveys. Seeded per region on first request and
-- cached, so a map is not empty before any neighbour has signed up.
--
-- This is the only layer that knows something a person could not work out from
-- a window and a calendar. It is also the most easily misread: occurrence
-- records measure observer effort as much as animal density, so presence is
-- informative and absence is close to meaningless.
CREATE TABLE IF NOT EXISTS historic (
  display_cell TEXT    PRIMARY KEY,
  region       TEXT    NOT NULL,
  n            INTEGER NOT NULL,
  months       TEXT    NOT NULL,  -- JSON array of 12 counts, January first
  first_year   INTEGER,
  last_year    INTEGER
);
CREATE INDEX IF NOT EXISTS idx_historic_region ON historic (region);

-- Which regions have been fetched, and when, so GBIF is asked once per region
-- per quarter rather than on every map pan.
CREATE TABLE IF NOT EXISTS historic_region (
  region     TEXT    PRIMARY KEY,
  fetched_at INTEGER NOT NULL,
  total      INTEGER NOT NULL DEFAULT 0,
  status     TEXT    NOT NULL DEFAULT 'ok'
);
