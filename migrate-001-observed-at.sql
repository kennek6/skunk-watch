-- Adds observed_at so a report can describe when the animal was seen rather
-- than when the report arrived. Backfills existing rows from created_at, which
-- is what they effectively meant before this column existed.
ALTER TABLE reports ADD COLUMN observed_at INTEGER NOT NULL DEFAULT 0;
UPDATE reports SET observed_at = created_at WHERE observed_at = 0;
CREATE INDEX IF NOT EXISTS idx_reports_region_observed ON reports (region, observed_at);
