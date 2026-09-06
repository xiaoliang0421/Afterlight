-- Purchased creation points are independent from daily free allowances and provider dollars.
ALTER TABLE settings ADD COLUMN reference_generation_enabled INTEGER NOT NULL DEFAULT 0 CHECK(reference_generation_enabled IN (0,1));
ALTER TABLE settings ADD COLUMN reference_points INTEGER NOT NULL DEFAULT 0 CHECK(reference_points BETWEEN 0 AND 100000);
ALTER TABLE settings ADD COLUMN reference_reserve_cents INTEGER NOT NULL DEFAULT 0 CHECK(reference_reserve_cents BETWEEN 0 AND 100000);
CREATE TABLE paid_credit_accounts (
 user_id TEXT PRIMARY KEY REFERENCES users(id),
 balance INTEGER NOT NULL DEFAULT 0,
 reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0),
 spent INTEGER NOT NULL DEFAULT 0 CHECK(spent>=0)
);
-- A refund of already-spent points can create a debt; it never silently mints replacement points.
CREATE TABLE payment_packages (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, points INTEGER NOT NULL CHECK(points>0),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0), currency TEXT NOT NULL CHECK(currency='USD'),
 paddle_price_id TEXT NOT NULL UNIQUE, environment TEXT NOT NULL CHECK(environment IN ('sandbox','production')),
 active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1))
);
CREATE TABLE payment_orders (
 id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), package_id TEXT NOT NULL REFERENCES payment_packages(id),
 idempotency_key TEXT NOT NULL, environment TEXT NOT NULL CHECK(environment IN ('sandbox','production')),
 points INTEGER NOT NULL CHECK(points>0), amount_cents INTEGER NOT NULL CHECK(amount_cents>0), currency TEXT NOT NULL,
 paddle_price_id TEXT NOT NULL, provider_transaction_id TEXT UNIQUE,
 status TEXT NOT NULL DEFAULT 'creating' CHECK(status IN ('creating','pending','completed','canceled','review','refunded')),
 terms_version TEXT NOT NULL, accepted_at INTEGER NOT NULL,
 granted_points INTEGER NOT NULL DEFAULT 0 CHECK(granted_points>=0 AND granted_points<=points),
 billing_hold INTEGER NOT NULL DEFAULT 0 CHECK(billing_hold IN (0,1)),
 revision INTEGER NOT NULL DEFAULT 0, sync_lock TEXT, sync_locked_at INTEGER,
 total_paid_cents INTEGER, tax_cents INTEGER, last_checked_at INTEGER,
 created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(user_id,idempotency_key)
);
CREATE UNIQUE INDEX one_open_checkout ON payment_orders(user_id) WHERE status IN ('creating','pending','review');
CREATE TABLE payment_events (
 id TEXT PRIMARY KEY, environment TEXT NOT NULL, event_type TEXT NOT NULL,
 entity_id TEXT NOT NULL, transaction_id TEXT NOT NULL, occurred_at TEXT NOT NULL,
 processed_at INTEGER, attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at INTEGER NOT NULL DEFAULT 0,
 last_error TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
);
CREATE INDEX payment_events_pending ON payment_events(processed_at,next_attempt_at);
CREATE TABLE paid_credit_ledger (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES payment_orders(id), user_id TEXT NOT NULL REFERENCES users(id),
 points_delta INTEGER NOT NULL, created_at INTEGER NOT NULL
);
CREATE TRIGGER payment_grant AFTER UPDATE OF granted_points ON payment_orders WHEN NEW.granted_points!=OLD.granted_points BEGIN
 INSERT INTO paid_credit_accounts(user_id) VALUES(NEW.user_id) ON CONFLICT(user_id) DO NOTHING;
 UPDATE paid_credit_accounts SET balance=balance+NEW.granted_points-OLD.granted_points WHERE user_id=NEW.user_id;
 INSERT INTO paid_credit_ledger VALUES(NEW.id||':'||NEW.revision,NEW.id,NEW.user_id,NEW.granted_points-OLD.granted_points,NEW.updated_at);
END;
CREATE TRIGGER payment_order_immutable BEFORE UPDATE ON payment_orders WHEN
 NEW.user_id!=OLD.user_id OR NEW.package_id!=OLD.package_id OR NEW.points!=OLD.points OR NEW.amount_cents!=OLD.amount_cents
 OR NEW.currency!=OLD.currency OR NEW.paddle_price_id!=OLD.paddle_price_id OR NEW.environment!=OLD.environment
 OR NEW.terms_version!=OLD.terms_version OR NEW.accepted_at!=OLD.accepted_at OR NEW.idempotency_key!=OLD.idempotency_key
 OR (OLD.provider_transaction_id IS NOT NULL AND NEW.provider_transaction_id IS NOT OLD.provider_transaction_id)
 BEGIN SELECT RAISE(ABORT,'order_is_immutable'); END;
ALTER TABLE tasks ADD COLUMN generation_mode TEXT NOT NULL DEFAULT 'text' CHECK(generation_mode IN ('text','reference'));
ALTER TABLE tasks ADD COLUMN provider_model TEXT NOT NULL DEFAULT 'minimax/h3-max-turbo/text-to-video';
ALTER TABLE tasks ADD COLUMN quoted_points INTEGER NOT NULL DEFAULT 0 CHECK(quoted_points>=0);
ALTER TABLE tasks ADD COLUMN quoted_reserve_cents INTEGER NOT NULL DEFAULT 0 CHECK(quoted_reserve_cents>=0);
-- Existing paid provider requests were originally free to the user. Keep their adapter; never charge them retroactively.
UPDATE tasks SET provider_model='minimax/h3-max/reference-to-video' WHERE
 json_extract(COALESCE(material_snapshot_json,'{}'),'$.mode')='reference' OR
 (provider_attempt_id IS NOT NULL AND json_extract(COALESCE(material_snapshot_json,'{}'),'$.mode') IS NULL);
CREATE TRIGGER task_mode_immutable BEFORE UPDATE ON tasks WHEN NEW.generation_mode!=OLD.generation_mode OR NEW.provider_model!=OLD.provider_model
 OR NEW.quoted_points!=OLD.quoted_points OR NEW.quoted_reserve_cents!=OLD.quoted_reserve_cents
 BEGIN SELECT RAISE(ABORT,'generation_quote_is_immutable'); END;
DROP TRIGGER task_admission;
DROP TRIGGER task_reserve;
DROP TRIGGER task_settle;
CREATE TRIGGER task_admission BEFORE UPDATE OF status ON tasks WHEN NEW.status='Queued' AND OLD.status IN ('Draft','NeedsReview') BEGIN
 SELECT (CASE WHEN (SELECT generation_enabled FROM settings WHERE id=1)!=1 THEN RAISE(ABORT,'generation_paused') END);
 SELECT (CASE WHEN (SELECT status FROM stories WHERE id=NEW.story_id)!='open' THEN RAISE(ABORT,'story_paused') END);
 SELECT (CASE WHEN NEW.plan_json IS NULL OR NEW.approved_plan_json IS NULL THEN RAISE(ABORT,'plan_required') END);
 SELECT (CASE WHEN (NEW.generation_mode='text' AND NEW.policy_version!='free-v1') OR (NEW.generation_mode='reference' AND NEW.policy_version!='paid-reference-v1') THEN RAISE(ABORT,'payment_disabled') END);
 SELECT (CASE WHEN NEW.generation_mode='reference' AND ((SELECT reference_generation_enabled FROM settings WHERE id=1)!=1 OR NEW.quoted_points<=0) THEN RAISE(ABORT,'reference_unavailable') END);
 SELECT (CASE WHEN NEW.generation_mode='reference' AND (COALESCE((SELECT balance-reserved FROM paid_credit_accounts WHERE user_id=NEW.user_id),0)<NEW.quoted_points OR EXISTS(SELECT 1 FROM payment_orders WHERE user_id=NEW.user_id AND billing_hold=1)) THEN RAISE(ABORT,'paid_credits_unavailable') END);
 SELECT (CASE WHEN EXISTS(SELECT 1 FROM tasks WHERE story_id=NEW.story_id AND user_id=NEW.user_id AND id!=NEW.id AND reservation_active=1) THEN RAISE(ABORT,'already_in_queue') END);
 SELECT (CASE WHEN (SELECT count(*) FROM tasks WHERE story_id=NEW.story_id AND reservation_active=1)>=(SELECT max_queue_per_story FROM settings WHERE id=1) THEN RAISE(ABORT,'queue_full') END);
 SELECT (CASE WHEN NEW.generation_mode='text' AND COALESCE((SELECT limit_units-reserved-spent FROM credit_accounts WHERE user_id=NEW.user_id AND period=NEW.quota_period),0)<1 THEN RAISE(ABORT,'credits_exhausted') END);
 SELECT (CASE WHEN COALESCE((SELECT limit_cents-reserved_cents-spent_cents FROM budget_periods WHERE kind='day' AND period=NEW.budget_day),0)<NEW.reserved_cents THEN RAISE(ABORT,'capacity_full') END);
 SELECT (CASE WHEN COALESCE((SELECT limit_cents-reserved_cents-spent_cents FROM budget_periods WHERE kind='month' AND period=NEW.budget_month),0)<NEW.reserved_cents THEN RAISE(ABORT,'capacity_full') END);
 SELECT (CASE WHEN (SELECT checked_at FROM provider_wallet WHERE id=1)<NEW.updated_at-300000 THEN RAISE(ABORT,'balance_stale') END);
 SELECT (CASE WHEN (SELECT balance_cents-reserved_cents-debited_cents FROM provider_wallet WHERE id=1)<NEW.reserved_cents THEN RAISE(ABORT,'provider_capacity') END);
END;
CREATE TRIGGER task_reserve AFTER UPDATE OF status ON tasks WHEN NEW.status='Queued' AND OLD.status IN ('Draft','NeedsReview') BEGIN
 UPDATE credit_accounts SET reserved=reserved+1 WHERE user_id=NEW.user_id AND period=NEW.quota_period AND NEW.generation_mode='text';
 UPDATE paid_credit_accounts SET reserved=reserved+NEW.quoted_points WHERE user_id=NEW.user_id AND NEW.generation_mode='reference';
 UPDATE budget_periods SET reserved_cents=reserved_cents+NEW.reserved_cents WHERE (kind='day' AND period=NEW.budget_day) OR (kind='month' AND period=NEW.budget_month);
 UPDATE provider_wallet SET reserved_cents=reserved_cents+NEW.reserved_cents WHERE id=1;
 UPDATE tasks SET reservation_active=1,queue_sequence=(SELECT next_sequence FROM stories WHERE id=NEW.story_id) WHERE id=NEW.id;
 UPDATE stories SET next_sequence=next_sequence+1 WHERE id=NEW.story_id;
 INSERT INTO ledger VALUES(NEW.id||':reserve:'||NEW.updated_at,NEW.id,NEW.user_id,'reserve',(CASE WHEN NEW.generation_mode='reference' THEN NEW.quoted_points ELSE 1 END),NEW.reserved_cents,NEW.policy_version,NEW.updated_at);
END;
CREATE TRIGGER task_settle AFTER UPDATE OF status ON tasks WHEN OLD.reservation_active=1 AND NEW.status IN ('Published','Cancelled','Failed','NeedsReview') BEGIN
 UPDATE credit_accounts SET reserved=reserved-1,spent=spent+ (CASE WHEN NEW.status='Published' THEN 1 ELSE 0 END) WHERE user_id=NEW.user_id AND period=NEW.quota_period AND NEW.generation_mode='text';
 UPDATE paid_credit_accounts SET reserved=reserved-NEW.quoted_points,balance=balance-NEW.quoted_points*(NEW.status='Published'),spent=spent+NEW.quoted_points*(NEW.status='Published') WHERE user_id=NEW.user_id AND NEW.generation_mode='reference';
 UPDATE budget_periods SET reserved_cents=reserved_cents-NEW.reserved_cents,spent_cents=spent_cents+NEW.recorded_cost_cents WHERE (kind='day' AND period=NEW.budget_day) OR (kind='month' AND period=NEW.budget_month);
 UPDATE provider_wallet SET reserved_cents=reserved_cents-NEW.reserved_cents,debited_cents=debited_cents+NEW.recorded_cost_cents WHERE id=1;
 UPDATE tasks SET reservation_active=0 WHERE id=NEW.id;
 UPDATE stories SET active_task_id=NULL WHERE id=NEW.story_id AND active_task_id=NEW.id;
 INSERT INTO ledger VALUES(NEW.id||':settle:'||NEW.updated_at,NEW.id,NEW.user_id, (CASE WHEN NEW.status='Published' THEN 'consume' ELSE 'release' END), (NEW.status='Published')*IIF(NEW.generation_mode='reference',NEW.quoted_points,1),NEW.recorded_cost_cents,NEW.policy_version,NEW.updated_at);
 INSERT INTO notifications VALUES(NEW.id||':'||NEW.status||':'||NEW.updated_at,NEW.user_id,NEW.story_id,NEW.id, (CASE NEW.status WHEN 'Published' THEN 'Your scene is now part of the story.' WHEN 'NeedsReview' THEN 'The story has changed. Review the updated scene before rejoining.' ELSE 'Your creation credit has been returned.' END),NULL,NEW.updated_at);
END;
