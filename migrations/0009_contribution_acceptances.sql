ALTER TABLE tasks ADD COLUMN terms_version TEXT;
ALTER TABLE tasks ADD COLUMN attribution_accepted_at INTEGER;
ALTER TABLE tasks ADD COLUMN attribution_plan_version INTEGER;
CREATE TABLE policy_documents(version TEXT PRIMARY KEY, document_json TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE contribution_acceptances (
 task_id TEXT NOT NULL REFERENCES tasks(id),
 queue_sequence INTEGER NOT NULL,
 user_id TEXT NOT NULL REFERENCES users(id),
 terms_version TEXT NOT NULL,
 plan_version INTEGER NOT NULL,
 approved_plan_json TEXT NOT NULL,
 accepted_at INTEGER NOT NULL,
 PRIMARY KEY(task_id,queue_sequence)
);
CREATE TRIGGER record_contribution_acceptance AFTER UPDATE OF reservation_active ON tasks WHEN NEW.reservation_active=1 AND OLD.reservation_active=0 AND NEW.terms_version IS NOT NULL BEGIN
 INSERT INTO contribution_acceptances(task_id,queue_sequence,user_id,terms_version,plan_version,approved_plan_json,accepted_at) SELECT id,queue_sequence,user_id,terms_version,attribution_plan_version,approved_plan_json,attribution_accepted_at FROM tasks WHERE id=NEW.id;
END;
