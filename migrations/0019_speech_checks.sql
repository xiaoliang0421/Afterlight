CREATE TABLE speech_checks (
 task_id TEXT PRIMARY KEY REFERENCES tasks(id),
 call_id TEXT NOT NULL UNIQUE,
 media_key TEXT NOT NULL,
 media_etag TEXT NOT NULL,
 duration_ms INTEGER NOT NULL CHECK(duration_ms>0 AND duration_ms<=20000),
 day TEXT NOT NULL, month TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('submitting','queued','completed','failed','uncertain','closed')),
 request_id TEXT UNIQUE, status_url TEXT, result_url TEXT,
 result_json TEXT, failure_code TEXT NOT NULL DEFAULT '',
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TRIGGER speech_check_guard BEFORE INSERT ON speech_checks BEGIN
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM tasks t JOIN users u ON u.id=t.user_id WHERE t.id=NEW.task_id
  AND t.status='NeedsModeration' AND t.media_ready=1 AND t.media_key=NEW.media_key AND t.media_duration_ms=NEW.duration_ms AND u.deleted_at IS NULL)
  THEN RAISE(ABORT,'speech_task_changed') END);
 SELECT (CASE WHEN (SELECT checked_at FROM provider_wallet WHERE id=1)<NEW.created_at-300000 THEN RAISE(ABORT,'balance_stale') END);
 SELECT (CASE WHEN (SELECT balance_cents-reserved_cents-debited_cents FROM provider_wallet WHERE id=1)<10 THEN RAISE(ABORT,'provider_capacity') END);
END;
CREATE TRIGGER speech_check_charge AFTER INSERT ON speech_checks BEGIN
 INSERT INTO model_calls(id,task_id,day,month,cost_ceiling_cents,kind,created_at) VALUES(NEW.call_id,NEW.task_id,NEW.day,NEW.month,10,'speech-check',NEW.created_at);
 UPDATE provider_wallet SET debited_cents=debited_cents+10 WHERE id=1;
END;
DROP TRIGGER model_budget_debit;
CREATE TRIGGER model_budget_debit AFTER INSERT ON model_calls BEGIN
 UPDATE budget_periods SET spent_cents=spent_cents+NEW.cost_ceiling_cents WHERE (kind='day' AND period=NEW.day) OR (kind='month' AND period=NEW.month);
 INSERT INTO ledger(id,task_id,kind,cents,policy_version,created_at) VALUES(NEW.id,NEW.task_id,CASE WHEN NEW.kind='speech-check' THEN 'speech-cost-ceiling' ELSE 'director-cost-ceiling' END,NEW.cost_ceiling_cents,'free-v1',NEW.created_at);
END;
DROP TRIGGER lifetime_task_budget;
CREATE TRIGGER lifetime_task_budget BEFORE UPDATE OF status ON tasks WHEN NEW.status='Queued' AND OLD.status IN ('Draft','NeedsReview') BEGIN
 SELECT (CASE WHEN COALESCE((SELECT SUM(cents) FROM ledger WHERE kind IN ('consume','release','director-cost-ceiling','speech-cost-ceiling')),0)+COALESCE((SELECT SUM(reserved_cents) FROM tasks WHERE reservation_active=1),0)+NEW.reserved_cents>(SELECT authorized_spend_cents FROM settings WHERE id=1) THEN RAISE(ABORT,'capacity_full') END);
END;
DROP TRIGGER lifetime_director_budget;
CREATE TRIGGER lifetime_director_budget BEFORE INSERT ON model_calls BEGIN
 SELECT (CASE WHEN COALESCE((SELECT SUM(cents) FROM ledger WHERE kind IN ('consume','release','director-cost-ceiling','speech-cost-ceiling')),0)+COALESCE((SELECT SUM(reserved_cents) FROM tasks WHERE reservation_active=1),0)+NEW.cost_ceiling_cents>(SELECT authorized_spend_cents FROM settings WHERE id=1) THEN RAISE(ABORT,'capacity_full') END);
END;
CREATE TRIGGER speech_attempt_immutable BEFORE UPDATE ON speech_checks WHEN
 NEW.call_id IS NOT OLD.call_id OR NEW.media_key IS NOT OLD.media_key OR NEW.media_etag IS NOT OLD.media_etag OR NEW.duration_ms IS NOT OLD.duration_ms
 OR NEW.created_at IS NOT OLD.created_at OR (OLD.request_id IS NOT NULL AND NEW.request_id IS NOT OLD.request_id)
BEGIN SELECT RAISE(ABORT,'speech_attempt_immutable'); END;
CREATE TRIGGER speech_deletion_guard BEFORE UPDATE OF deleted_at ON users WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
 AND EXISTS(SELECT 1 FROM speech_checks s JOIN tasks t ON t.id=s.task_id WHERE t.user_id=NEW.id AND s.status IN ('submitting','queued','uncertain'))
BEGIN SELECT RAISE(ABORT,'deletion_active_speech_check'); END;
CREATE TRIGGER speech_account_deleted AFTER UPDATE OF deleted_at ON users WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL BEGIN
 UPDATE speech_checks SET result_json=NULL,status_url=NULL,result_url=NULL WHERE task_id IN (SELECT id FROM tasks WHERE user_id=NEW.id);
END;
