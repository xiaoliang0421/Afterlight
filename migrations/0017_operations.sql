CREATE TABLE operation_health (
  name TEXT PRIMARY KEY,
  started_at INTEGER NOT NULL DEFAULT 0,
  completed_at INTEGER NOT NULL DEFAULT 0,
  failure_at INTEGER NOT NULL DEFAULT 0
);
INSERT INTO operation_health(name) VALUES('reconciliation');
