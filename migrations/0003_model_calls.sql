CREATE TABLE model_calls (id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), day TEXT NOT NULL, month TEXT NOT NULL, cost_ceiling_cents INTEGER NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'submitted', created_at INTEGER NOT NULL);
CREATE TRIGGER model_budget_guard BEFORE INSERT ON model_calls BEGIN
 SELECT CASE WHEN (SELECT generation_enabled FROM settings WHERE id=1)!=1 THEN RAISE(ABORT,'generation_paused') END;
 SELECT CASE WHEN COALESCE((SELECT limit_cents-reserved_cents-spent_cents FROM budget_periods WHERE kind='day' AND period=NEW.day),0)<NEW.cost_ceiling_cents THEN RAISE(ABORT,'capacity_full') END;
 SELECT CASE WHEN COALESCE((SELECT limit_cents-reserved_cents-spent_cents FROM budget_periods WHERE kind='month' AND period=NEW.month),0)<NEW.cost_ceiling_cents THEN RAISE(ABORT,'capacity_full') END;
END;
CREATE TRIGGER model_budget_debit AFTER INSERT ON model_calls BEGIN
 UPDATE budget_periods SET spent_cents=spent_cents+NEW.cost_ceiling_cents WHERE (kind='day' AND period=NEW.day) OR (kind='month' AND period=NEW.month);
 INSERT INTO ledger(id,task_id,kind,cents,policy_version,created_at) VALUES(NEW.id,NEW.task_id,'director-cost-ceiling',NEW.cost_ceiling_cents,'free-v1',NEW.created_at);
END;
