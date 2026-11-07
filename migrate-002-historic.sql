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
