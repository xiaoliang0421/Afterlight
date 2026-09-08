-- Production source and customer billing are independent. Existing tasks retain their original contract.
ALTER TABLE settings ADD COLUMN text_points INTEGER NOT NULL DEFAULT 0 CHECK(text_points BETWEEN 0 AND 100000);
ALTER TABLE settings ADD COLUMN uploads_enabled INTEGER NOT NULL DEFAULT 0 CHECK(uploads_enabled IN (0,1));
ALTER TABLE tasks ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'generated' CHECK(source_kind IN ('generated','upload'));
ALTER TABLE tasks ADD COLUMN billing_kind TEXT NOT NULL DEFAULT 'legacy-free' CHECK(billing_kind IN ('points','legacy-free','upload'));
-- Old text writers retain their free contract during the deployment window.
-- New API writers always pass billing_kind='points' explicitly.
UPDATE tasks SET billing_kind='points' WHERE generation_mode='reference';
ALTER TABLE tasks ADD COLUMN proposal_ids_json TEXT NOT NULL DEFAULT '[]';
ALTER TABLE tasks ADD COLUMN upload_bytes INTEGER;
ALTER TABLE tasks ADD COLUMN upload_lock TEXT;
ALTER TABLE tasks ADD COLUMN upload_locked_at INTEGER;
ALTER TABLE tasks ADD COLUMN upload_rights_accepted_at INTEGER;
CREATE TABLE upload_attempts (
 id TEXT PRIMARY KEY, task_id TEXT NOT NULL REFERENCES tasks(id), object_key TEXT NOT NULL UNIQUE,
 expires_at INTEGER NOT NULL, deleted_at INTEGER
);
CREATE TRIGGER production_contract_immutable BEFORE UPDATE ON tasks WHEN
 NEW.source_kind!=OLD.source_kind OR NEW.billing_kind!=OLD.billing_kind OR NEW.user_id!=OLD.user_id
 OR NEW.story_id!=OLD.story_id OR NEW.proposal_ids_json!=OLD.proposal_ids_json
BEGIN SELECT RAISE(ABORT,'production_contract_immutable'); END;
CREATE TRIGGER production_source_guard BEFORE INSERT ON tasks BEGIN
 SELECT CASE WHEN NEW.source_kind='upload' AND (NEW.billing_kind!='upload' OR NEW.quoted_points!=0 OR NEW.quoted_reserve_cents!=0 OR NEW.user_id!=(SELECT owner_id FROM stories WHERE id=NEW.story_id)) THEN RAISE(ABORT,'upload_owner_required') END;
 SELECT CASE WHEN NEW.source_kind='generated' AND NEW.billing_kind='upload' THEN RAISE(ABORT,'generation_price_unavailable') END;
END;
CREATE TABLE story_proposals (
 id TEXT PRIMARY KEY, story_id TEXT NOT NULL REFERENCES stories(id), author_id TEXT NOT NULL REFERENCES users(id),
 prompt TEXT NOT NULL, base_version INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending'
 CHECK(status IN ('pending','selected','published','withdrawn','declined')),
 selected_task_id TEXT REFERENCES tasks(id), idempotency_key TEXT NOT NULL,
 terms_version TEXT NOT NULL, attribution_accepted_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(author_id,idempotency_key)
);
CREATE INDEX proposals_story ON story_proposals(story_id,status,created_at);
CREATE TRIGGER proposal_author_guard BEFORE INSERT ON story_proposals BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.author_id AND deleted_at IS NULL) THEN RAISE(ABORT,'account_deleted') END;
END;
CREATE TRIGGER proposal_content_immutable BEFORE UPDATE ON story_proposals WHEN
 NEW.id!=OLD.id OR NEW.story_id!=OLD.story_id OR NEW.author_id!=OLD.author_id OR (NEW.prompt!=OLD.prompt AND NOT ((SELECT deleted_at FROM users WHERE id=NEW.author_id) IS NOT NULL AND NEW.prompt='Removed at the author’s request.'))
 OR NEW.terms_version!=OLD.terms_version OR NEW.attribution_accepted_at!=OLD.attribution_accepted_at
BEGIN SELECT RAISE(ABORT,'proposal_content_immutable'); END;
CREATE TRIGGER production_proposals_guard BEFORE INSERT ON tasks WHEN json_array_length(NEW.proposal_ids_json)>0 BEGIN
 SELECT CASE WHEN NEW.user_id!=(SELECT owner_id FROM stories WHERE id=NEW.story_id)
 OR json_array_length(NEW.proposal_ids_json)>5
 OR (SELECT COUNT(DISTINCT value) FROM json_each(NEW.proposal_ids_json))!=json_array_length(NEW.proposal_ids_json)
 OR EXISTS(SELECT 1 FROM json_each(NEW.proposal_ids_json) j WHERE NOT EXISTS(
 SELECT 1 FROM story_proposals p JOIN users u ON u.id=p.author_id WHERE p.id=j.value AND p.story_id=NEW.story_id AND p.status='pending' AND u.deleted_at IS NULL))
 THEN RAISE(ABORT,'proposal_changed') END;
END;
CREATE TRIGGER production_proposals_selected AFTER INSERT ON tasks BEGIN
 UPDATE story_proposals SET status='selected',selected_task_id=NEW.id,updated_at=NEW.updated_at WHERE id IN (SELECT value FROM json_each(NEW.proposal_ids_json));
END;
CREATE TRIGGER production_proposals_released AFTER UPDATE OF status ON tasks WHEN NEW.status IN ('Cancelled','Failed') BEGIN
 UPDATE story_proposals SET status='pending',selected_task_id=NULL,updated_at=NEW.updated_at WHERE selected_task_id=NEW.id AND status='selected';
END;
CREATE TRIGGER production_proposals_published AFTER INSERT ON scenes BEGIN
 UPDATE story_proposals SET status='published',updated_at=NEW.published_at WHERE selected_task_id=NEW.task_id AND status='selected';
 INSERT INTO notifications(id,user_id,story_id,task_id,message,created_at)
 SELECT NEW.id||':proposal:'||p.id,p.author_id,NEW.story_id,NEW.task_id,'Your idea was adopted in a published scene.',NEW.published_at
 FROM story_proposals p WHERE p.selected_task_id=NEW.task_id;
END;
CREATE TRIGGER uploaded_provider_guard BEFORE UPDATE OF provider_attempt_id,reserved_cents,recorded_cost_cents ON tasks WHEN NEW.source_kind='upload' AND
 (NEW.provider_attempt_id IS NOT NULL OR NEW.reserved_cents!=0 OR NEW.recorded_cost_cents!=0)
BEGIN SELECT RAISE(ABORT,'upload_cannot_generate'); END;
DROP TRIGGER generation_access_task;
CREATE TRIGGER generation_access_task BEFORE UPDATE OF status,provider_attempt_id ON tasks
 WHEN NEW.source_kind='generated' AND ((NEW.status IN ('Queued','Generating') AND NEW.status!=OLD.status)
 OR (NEW.provider_attempt_id IS NOT NULL AND OLD.provider_attempt_id IS NULL)) BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM generation_allowed_users WHERE id=NEW.user_id) THEN RAISE(ABORT,'generation_restricted') END;
END;
DROP TRIGGER lifetime_task_budget;
CREATE TRIGGER lifetime_task_budget BEFORE UPDATE OF status ON tasks WHEN NEW.source_kind='generated' AND NEW.status='Queued' AND OLD.status IN ('Draft','NeedsReview') BEGIN
 SELECT CASE WHEN COALESCE((SELECT SUM(cents) FROM ledger WHERE kind IN ('consume','release','director-cost-ceiling','speech-cost-ceiling')),0)+COALESCE((SELECT SUM(reserved_cents) FROM tasks WHERE reservation_active=1),0)+NEW.reserved_cents>(SELECT authorized_spend_cents FROM settings WHERE id=1) THEN RAISE(ABORT,'capacity_full') END;
END;
CREATE TRIGGER purchased_attempt_guard BEFORE UPDATE OF provider_attempt_id ON tasks WHEN NEW.billing_kind='points' AND NEW.provider_attempt_id IS NOT NULL AND OLD.provider_attempt_id IS NULL BEGIN
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM paid_credit_accounts WHERE user_id=NEW.user_id AND balance>=reserved AND reserved>=NEW.quoted_points)
 OR EXISTS(SELECT 1 FROM payment_orders WHERE user_id=NEW.user_id AND billing_hold=1) THEN RAISE(ABORT,'paid_credits_unavailable') END;
END;
DROP TRIGGER task_admission;
DROP TRIGGER task_reserve;
DROP TRIGGER task_settle;
CREATE TRIGGER task_admission BEFORE UPDATE OF status ON tasks WHEN NEW.status='Queued' AND OLD.status IN ('Draft','NeedsReview') BEGIN
 SELECT (CASE WHEN NEW.source_kind='generated' AND (SELECT generation_enabled FROM settings WHERE id=1)!=1 THEN RAISE(ABORT,'generation_paused') END);
 SELECT (CASE WHEN NEW.source_kind='generated' AND NEW.billing_kind='points' AND NEW.quoted_points<=0 THEN RAISE(ABORT,'generation_price_unavailable') END);
 SELECT (CASE WHEN NEW.source_kind='upload' AND ((SELECT uploads_enabled FROM settings WHERE id=1)!=1 OR NEW.media_ready!=1 OR NEW.media_key IS NULL OR NEW.media_duration_ms>60000 OR NEW.user_id!=(SELECT owner_id FROM stories WHERE id=NEW.story_id) OR NEW.base_version!=(SELECT version FROM stories WHERE id=NEW.story_id)) THEN RAISE(ABORT,'upload_not_ready') END);
 SELECT (CASE WHEN (SELECT status FROM stories WHERE id=NEW.story_id)!='open' THEN RAISE(ABORT,'story_paused') END);
 SELECT (CASE WHEN NEW.plan_json IS NULL OR NEW.approved_plan_json IS NULL THEN RAISE(ABORT,'plan_required') END);
 SELECT (CASE WHEN (NEW.billing_kind='legacy-free' AND NEW.policy_version!='free-v1') OR (NEW.billing_kind='points' AND NEW.policy_version NOT IN ('paid-reference-v1','paid-generation-v2')) OR (NEW.billing_kind='upload' AND NEW.policy_version!='owner-upload-v1') THEN RAISE(ABORT,'payment_disabled') END);
 SELECT (CASE WHEN NEW.source_kind='generated' AND NEW.generation_mode='reference' AND ((SELECT reference_generation_enabled FROM settings WHERE id=1)!=1 OR NEW.quoted_points<=0) THEN RAISE(ABORT,'reference_unavailable') END);
 SELECT (CASE WHEN NEW.billing_kind='points' AND (COALESCE((SELECT balance-reserved FROM paid_credit_accounts WHERE user_id=NEW.user_id),0)<NEW.quoted_points OR EXISTS(SELECT 1 FROM payment_orders WHERE user_id=NEW.user_id AND billing_hold=1)) THEN RAISE(ABORT,'paid_credits_unavailable') END);
 SELECT (CASE WHEN EXISTS(SELECT 1 FROM tasks WHERE story_id=NEW.story_id AND user_id=NEW.user_id AND id!=NEW.id AND reservation_active=1) THEN RAISE(ABORT,'already_in_queue') END);
 SELECT (CASE WHEN (SELECT count(*) FROM tasks WHERE story_id=NEW.story_id AND reservation_active=1)>=(SELECT max_queue_per_story FROM settings WHERE id=1) THEN RAISE(ABORT,'queue_full') END);
 SELECT (CASE WHEN NEW.billing_kind='legacy-free' AND COALESCE((SELECT limit_units-reserved-spent FROM credit_accounts WHERE user_id=NEW.user_id AND period=NEW.quota_period),0)<1 THEN RAISE(ABORT,'credits_exhausted') END);
 SELECT (CASE WHEN COALESCE((SELECT limit_cents-reserved_cents-spent_cents FROM budget_periods WHERE kind='day' AND period=NEW.budget_day),0)<NEW.reserved_cents THEN RAISE(ABORT,'capacity_full') END);
 SELECT (CASE WHEN COALESCE((SELECT limit_cents-reserved_cents-spent_cents FROM budget_periods WHERE kind='month' AND period=NEW.budget_month),0)<NEW.reserved_cents THEN RAISE(ABORT,'capacity_full') END);
 SELECT (CASE WHEN NEW.source_kind='generated' AND (SELECT checked_at FROM provider_wallet WHERE id=1)<NEW.updated_at-300000 THEN RAISE(ABORT,'balance_stale') END);
 SELECT (CASE WHEN NEW.source_kind='generated' AND (SELECT balance_cents-reserved_cents-debited_cents FROM provider_wallet WHERE id=1)<NEW.reserved_cents THEN RAISE(ABORT,'provider_capacity') END);
END;
CREATE TRIGGER task_reserve AFTER UPDATE OF status ON tasks WHEN NEW.status='Queued' AND OLD.status IN ('Draft','NeedsReview') BEGIN
 UPDATE credit_accounts SET reserved=reserved+1 WHERE user_id=NEW.user_id AND period=NEW.quota_period AND NEW.billing_kind='legacy-free';
 UPDATE paid_credit_accounts SET reserved=reserved+NEW.quoted_points WHERE user_id=NEW.user_id AND NEW.billing_kind='points';
 UPDATE budget_periods SET reserved_cents=reserved_cents+NEW.reserved_cents WHERE (kind='day' AND period=NEW.budget_day) OR (kind='month' AND period=NEW.budget_month);
 UPDATE provider_wallet SET reserved_cents=reserved_cents+NEW.reserved_cents WHERE id=1;
 UPDATE tasks SET reservation_active=1,queue_sequence=(SELECT next_sequence FROM stories WHERE id=NEW.story_id) WHERE id=NEW.id;
 UPDATE stories SET next_sequence=next_sequence+1 WHERE id=NEW.story_id;
 INSERT INTO ledger VALUES(NEW.id||':reserve:'||NEW.updated_at,NEW.id,NEW.user_id,'reserve',(CASE WHEN NEW.billing_kind='points' THEN NEW.quoted_points WHEN NEW.billing_kind='upload' THEN 0 ELSE 1 END),NEW.reserved_cents,NEW.policy_version,NEW.updated_at);
END;
CREATE TRIGGER task_settle AFTER UPDATE OF status ON tasks WHEN OLD.reservation_active=1 AND NEW.status IN ('Published','Cancelled','Failed','NeedsReview') BEGIN
 UPDATE credit_accounts SET reserved=reserved-1,spent=spent+ (CASE WHEN NEW.status='Published' THEN 1 ELSE 0 END) WHERE user_id=NEW.user_id AND period=NEW.quota_period AND NEW.billing_kind='legacy-free';
 UPDATE paid_credit_accounts SET reserved=reserved-NEW.quoted_points,balance=balance-NEW.quoted_points*(NEW.status='Published'),spent=spent+NEW.quoted_points*(NEW.status='Published') WHERE user_id=NEW.user_id AND NEW.billing_kind='points';
 UPDATE budget_periods SET reserved_cents=reserved_cents-NEW.reserved_cents,spent_cents=spent_cents+NEW.recorded_cost_cents WHERE (kind='day' AND period=NEW.budget_day) OR (kind='month' AND period=NEW.budget_month);
 UPDATE provider_wallet SET reserved_cents=reserved_cents-NEW.reserved_cents,debited_cents=debited_cents+NEW.recorded_cost_cents WHERE id=1;
 UPDATE tasks SET reservation_active=0 WHERE id=NEW.id;
 UPDATE stories SET active_task_id=NULL WHERE id=NEW.story_id AND active_task_id=NEW.id;
 INSERT INTO ledger VALUES(NEW.id||':settle:'||NEW.updated_at,NEW.id,NEW.user_id, (CASE WHEN NEW.status='Published' THEN 'consume' ELSE 'release' END), (NEW.status='Published')*IIF(NEW.billing_kind='points',NEW.quoted_points,IIF(NEW.billing_kind='upload',0,1)),NEW.recorded_cost_cents,NEW.policy_version,NEW.updated_at);
 INSERT INTO notifications VALUES(NEW.id||':'||NEW.status||':'||NEW.updated_at,NEW.user_id,NEW.story_id,NEW.id, (CASE NEW.status WHEN 'Published' THEN 'Your scene is now part of the story.' WHEN 'NeedsReview' THEN 'The story has changed. Review the updated scene before rejoining.' ELSE IIF(NEW.billing_kind='upload','Your uploaded scene was not published.','Your reserved creation balance has been returned.') END),NULL,NEW.updated_at);
END;

CREATE TRIGGER proposal_deletion_guard BEFORE UPDATE OF deleted_at ON users WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL
 AND EXISTS(SELECT 1 FROM story_proposals WHERE author_id=NEW.id AND status='selected')
BEGIN SELECT RAISE(ABORT,'deletion_active_proposals'); END;
CREATE TRIGGER proposal_account_deleted AFTER UPDATE OF deleted_at ON users WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL BEGIN
 DELETE FROM story_proposals WHERE author_id=NEW.id AND status!='published';
 UPDATE story_proposals SET prompt='Removed at the author’s request.' WHERE author_id=NEW.id;
END;
