ALTER TABLE settings ADD COLUMN authorized_spend_cents INTEGER NOT NULL DEFAULT 0 CHECK(authorized_spend_cents>=0);
CREATE TRIGGER lifetime_task_budget BEFORE UPDATE OF status ON tasks WHEN NEW.status='Queued' AND OLD.status IN ('Draft','NeedsReview') BEGIN
 SELECT (CASE WHEN COALESCE((SELECT SUM(cents) FROM ledger WHERE kind IN ('consume','release','director-cost-ceiling')),0)+COALESCE((SELECT SUM(reserved_cents) FROM tasks WHERE reservation_active=1),0)+NEW.reserved_cents>(SELECT authorized_spend_cents FROM settings WHERE id=1) THEN RAISE(ABORT,'capacity_full') END);
END;
CREATE TRIGGER lifetime_director_budget BEFORE INSERT ON model_calls BEGIN
 SELECT (CASE WHEN COALESCE((SELECT SUM(cents) FROM ledger WHERE kind IN ('consume','release','director-cost-ceiling')),0)+COALESCE((SELECT SUM(reserved_cents) FROM tasks WHERE reservation_active=1),0)+NEW.cost_ceiling_cents>(SELECT authorized_spend_cents FROM settings WHERE id=1) THEN RAISE(ABORT,'capacity_full') END);
END;
CREATE TRIGGER story_owner_limit BEFORE INSERT ON stories BEGIN
 SELECT (CASE WHEN (SELECT COUNT(*) FROM stories WHERE owner_id=NEW.owner_id)>=(SELECT max_stories_per_user FROM settings WHERE id=1) THEN RAISE(ABORT,'story_limit') END);
END;
