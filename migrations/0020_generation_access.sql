-- New environments stay restricted until an operator explicitly admits testers.
ALTER TABLE settings ADD COLUMN generation_restricted INTEGER NOT NULL DEFAULT 1 CHECK(generation_restricted IN (0,1));
CREATE TABLE generation_testers (user_id TEXT PRIMARY KEY REFERENCES users(id), admitted_at INTEGER NOT NULL);
CREATE VIEW generation_allowed_users AS
 SELECT u.id FROM users u JOIN settings s ON s.id=1 WHERE u.deleted_at IS NULL
 AND (s.generation_restricted=0 OR EXISTS(SELECT 1 FROM generation_testers g WHERE g.user_id=u.id));

-- Check both admission and the durable marker immediately preceding video I/O.
CREATE TRIGGER generation_access_task BEFORE UPDATE OF status,provider_attempt_id ON tasks
 WHEN (NEW.status IN ('Queued','Generating') AND NEW.status!=OLD.status)
 OR (NEW.provider_attempt_id IS NOT NULL AND OLD.provider_attempt_id IS NULL) BEGIN
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM generation_allowed_users WHERE id=NEW.user_id)
  THEN RAISE(ABORT,'generation_restricted') END);
END;

-- Covers previews, execution rechecks, speech checks and archive model calls.
CREATE TRIGGER generation_access_model BEFORE INSERT ON model_calls BEGIN
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM tasks t JOIN generation_allowed_users u ON u.id=t.user_id WHERE t.id=NEW.task_id)
  THEN RAISE(ABORT,'generation_restricted') END);
END;
