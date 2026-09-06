ALTER TABLE tasks ADD COLUMN provider_input_json TEXT;
ALTER TABLE tasks ADD COLUMN provider_submitted_at INTEGER;
CREATE UNIQUE INDEX tasks_provider_request_unique ON tasks(provider_request_id) WHERE provider_request_id IS NOT NULL;
CREATE TRIGGER task_attempt_immutable BEFORE UPDATE OF provider_attempt_id,provider_input_json,provider_submitted_at,provider_request_id ON tasks
WHEN (OLD.provider_attempt_id IS NOT NULL AND (NEW.provider_attempt_id IS NOT OLD.provider_attempt_id OR NEW.provider_input_json IS NOT OLD.provider_input_json OR NEW.provider_submitted_at IS NOT OLD.provider_submitted_at))
 OR (OLD.provider_request_id IS NOT NULL AND NEW.provider_request_id IS NOT OLD.provider_request_id)
BEGIN
  SELECT RAISE(ABORT,'provider_attempt_immutable');
END;
