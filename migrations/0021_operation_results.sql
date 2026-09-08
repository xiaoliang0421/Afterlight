ALTER TABLE operation_health ADD COLUMN run_id TEXT NOT NULL DEFAULT '';
ALTER TABLE operation_health ADD COLUMN status TEXT NOT NULL DEFAULT 'unknown'
  CHECK(status IN ('unknown','running','succeeded','failed','skipped'));
