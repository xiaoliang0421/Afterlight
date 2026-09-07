ALTER TABLE account_requests ADD COLUMN response TEXT NOT NULL DEFAULT '';
ALTER TABLE account_requests ADD COLUMN responded_at INTEGER;
CREATE TABLE account_deletions (
 request_id TEXT PRIMARY KEY REFERENCES account_requests(id),
 user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
 reviewer_id TEXT NOT NULL REFERENCES users(id),
 policy_version TEXT NOT NULL,
 reviewed_content INTEGER NOT NULL CHECK(reviewed_content=1),
 created_at INTEGER NOT NULL,
 completed_at INTEGER
);
CREATE TABLE privacy_media_cleanup (
 object_key TEXT PRIMARY KEY,
 request_id TEXT NOT NULL REFERENCES account_deletions(request_id),
 queued_at INTEGER NOT NULL,
 completed_at INTEGER
);
CREATE TRIGGER deletion_request_guard BEFORE INSERT ON account_deletions BEGIN
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM account_requests r JOIN users u ON u.id=r.user_id
  WHERE r.id=NEW.request_id AND r.user_id=NEW.user_id AND r.status='open' AND u.deleted_at IS NULL)
  THEN RAISE(ABORT,'deletion_request_changed') END);
 SELECT (CASE WHEN NEW.reviewer_id=NEW.user_id OR NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.reviewer_id AND role='admin' AND deleted_at IS NULL)
  THEN RAISE(ABORT,'deletion_reviewer_required') END);
END;
CREATE TRIGGER account_deletion_guard BEFORE UPDATE OF deleted_at ON users WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL BEGIN
 SELECT (CASE WHEN OLD.role='admin' THEN RAISE(ABORT,'deletion_admin_role') END);
 SELECT (CASE WHEN NOT EXISTS(SELECT 1 FROM account_deletions d JOIN account_requests r ON r.id=d.request_id
  WHERE d.user_id=NEW.id AND d.completed_at IS NULL AND r.status='open') THEN RAISE(ABORT,'deletion_request_changed') END);
 SELECT (CASE WHEN EXISTS(SELECT 1 FROM tasks t WHERE (t.user_id=NEW.id OR t.story_id IN (SELECT id FROM stories WHERE owner_id=NEW.id))
  AND (t.reservation_active=1 OR t.preview_lock IS NOT NULL OR t.status IN ('Queued','Preparing','Generating','Checking','NeedsModeration','Packaging','ReconciliationNeeded')))
  THEN RAISE(ABORT,'deletion_active_tasks') END);
 SELECT (CASE WHEN EXISTS(SELECT 1 FROM payment_orders WHERE user_id=NEW.id AND (billing_hold=1 OR status IN ('creating','pending','review')))
  OR EXISTS(SELECT 1 FROM paid_credit_accounts WHERE user_id=NEW.id AND (balance!=0 OR reserved!=0))
  OR EXISTS(SELECT 1 FROM billing_requests WHERE user_id=NEW.id AND status='open')
  THEN RAISE(ABORT,'deletion_billing_unresolved') END);
 SELECT (CASE WHEN EXISTS(SELECT 1 FROM reports WHERE user_id=NEW.id AND status='open')
  THEN RAISE(ABORT,'deletion_reports_unresolved') END);
END;
-- An account erasure may remove a terminal request's input while keeping its request IDs.
-- Active and uncertain requests are blocked by account_deletion_guard above.
DROP TRIGGER task_attempt_immutable;
CREATE TRIGGER task_attempt_immutable BEFORE UPDATE OF provider_attempt_id,provider_input_json,provider_submitted_at,provider_request_id ON tasks
WHEN ((OLD.provider_attempt_id IS NOT NULL AND (NEW.provider_attempt_id IS NOT OLD.provider_attempt_id OR NEW.provider_input_json IS NOT OLD.provider_input_json OR NEW.provider_submitted_at IS NOT OLD.provider_submitted_at))
 OR (OLD.provider_request_id IS NOT NULL AND NEW.provider_request_id IS NOT OLD.provider_request_id))
 AND NOT ((SELECT deleted_at FROM users WHERE id=OLD.user_id) IS NOT NULL
  AND NEW.provider_input_json IS NULL AND NEW.provider_attempt_id IS OLD.provider_attempt_id
  AND NEW.provider_submitted_at IS OLD.provider_submitted_at AND NEW.provider_request_id IS OLD.provider_request_id)
BEGIN SELECT RAISE(ABORT,'provider_attempt_immutable'); END;
CREATE TRIGGER account_deleted AFTER UPDATE OF deleted_at ON users WHEN OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL BEGIN
 INSERT OR IGNORE INTO privacy_media_cleanup(object_key,request_id,queued_at)
 SELECT t.media_key,d.request_id,NEW.deleted_at FROM tasks t JOIN account_deletions d ON d.user_id=t.user_id
 WHERE t.user_id=NEW.id AND t.status!='Published' AND t.media_key LIKE 'stories/'||t.story_id||'/tasks/'||t.id||'/%'
 AND NOT EXISTS(SELECT 1 FROM scenes WHERE media_key=t.media_key);
 INSERT OR IGNORE INTO privacy_media_cleanup(object_key,request_id,queued_at)
 SELECT t.captions_key,d.request_id,NEW.deleted_at FROM tasks t JOIN account_deletions d ON d.user_id=t.user_id
 WHERE t.user_id=NEW.id AND t.status!='Published' AND t.captions_key LIKE 'stories/'||t.story_id||'/tasks/'||t.id||'/%'
 AND NOT EXISTS(SELECT 1 FROM scenes WHERE captions_key=t.captions_key);
 UPDATE stories SET status='paused',updated_at=NEW.deleted_at WHERE owner_id=NEW.id;
 UPDATE owner_reviews SET status='expired',decided_at=NEW.deleted_at WHERE status='pending' AND story_id IN (SELECT id FROM stories WHERE owner_id=NEW.id);
 DELETE FROM owner_reviews WHERE requester_id=NEW.id;
 DELETE FROM contribution_acceptances WHERE user_id=NEW.id;
 UPDATE tasks SET status=CASE WHEN status IN ('Draft','NeedsReview') THEN 'Cancelled' ELSE status END,prompt_original='',plan_json=NULL,approved_plan_json=NULL,reason='',requested_character_ids_json='[]',
  material_snapshot_json=NULL,owner_review_id=NULL,owner_review_status=NULL,owner_review_note=NULL,
  provider_input_json=NULL,provider_result_url=NULL,provider_status_url=NULL,updated_at=NEW.deleted_at WHERE user_id=NEW.id;
 UPDATE tasks SET media_key=NULL,captions_key=NULL,media_ready=0 WHERE user_id=NEW.id AND status!='Published';
 UPDATE scenes SET prompt_original='Removed at the author''s request.',english_prompt='' WHERE author_id=NEW.id;
 DELETE FROM favorites WHERE user_id=NEW.id;
 DELETE FROM watch_progress WHERE user_id=NEW.id;
 DELETE FROM notifications WHERE user_id=NEW.id;
 DELETE FROM credit_accounts WHERE user_id=NEW.id;
 DELETE FROM paid_credit_accounts WHERE user_id=NEW.id;
 UPDATE reports SET reason='' WHERE user_id=NEW.id;
 UPDATE billing_requests SET reason='',response='' WHERE user_id=NEW.id;
 DELETE FROM sessions WHERE user_id=NEW.id;
 DELETE FROM verification WHERE identifier=OLD.email;
 DELETE FROM "session" WHERE userId=NEW.id;
 DELETE FROM "account" WHERE userId=NEW.id;
 DELETE FROM "user" WHERE id=NEW.id;
 UPDATE users SET email=NULL,display_name='Deleted storyteller',nickname_key='' WHERE id=NEW.id;
 UPDATE account_requests SET reason='',response='Account sign-in and profile removed. Published scenes remain with anonymous attribution; accounting and policy records remain where required.',
  responded_at=NEW.deleted_at,resolved_at=NEW.deleted_at,status='resolved' WHERE user_id=NEW.id AND status='open';
 UPDATE account_requests SET reason='' WHERE user_id=NEW.id;
 UPDATE account_deletions SET completed_at=NEW.deleted_at WHERE user_id=NEW.id;
 INSERT INTO audit_log(id,actor_id,action,target_id,detail,created_at)
 SELECT request_id||':deleted',reviewer_id,'account.deleted',NEW.id,'{}',NEW.deleted_at FROM account_deletions WHERE user_id=NEW.id;
END;

-- Requests authenticated before erasure must not recreate private activity afterward.
CREATE TRIGGER deleted_user_tombstone BEFORE UPDATE ON users
WHEN OLD.deleted_at IS NOT NULL AND (NEW.deleted_at IS NOT OLD.deleted_at OR NEW.email IS NOT NULL
 OR NEW.display_name!='Deleted storyteller' OR NEW.nickname_key!='' OR NEW.role IS NOT OLD.role)
BEGIN SELECT RAISE(ABORT,'account_deleted'); END;
CREATE TRIGGER deleted_task_restart BEFORE UPDATE ON tasks
WHEN (SELECT deleted_at FROM users WHERE id=NEW.user_id) IS NOT NULL
 AND (NEW.status NOT IN ('Published','Failed','Cancelled') OR NEW.reservation_active=1 OR NEW.preview_lock IS NOT NULL
 OR NEW.prompt_original!='' OR NEW.plan_json IS NOT NULL OR NEW.approved_plan_json IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'account_deleted'); END;
CREATE TRIGGER deleted_user_insert_stories BEFORE INSERT ON stories
WHEN (SELECT deleted_at FROM users WHERE id=NEW.owner_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT,'account_deleted'); END;
CREATE TRIGGER deleted_user_insert_tasks BEFORE INSERT ON tasks
WHEN (SELECT deleted_at FROM users WHERE id=NEW.user_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT,'account_deleted'); END;
CREATE TRIGGER deleted_user_insert_sessions BEFORE INSERT ON sessions
WHEN (SELECT deleted_at FROM users WHERE id=NEW.user_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT,'account_deleted'); END;
CREATE TRIGGER deleted_user_insert_favorites BEFORE INSERT ON favorites
WHEN (SELECT deleted_at FROM users WHERE id=NEW.user_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT,'account_deleted'); END;
CREATE TRIGGER deleted_user_insert_watch_progress BEFORE INSERT ON watch_progress
WHEN (SELECT deleted_at FROM users WHERE id=NEW.user_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT,'account_deleted'); END;
CREATE TRIGGER deleted_user_insert_reports BEFORE INSERT ON reports
WHEN (SELECT deleted_at FROM users WHERE id=NEW.user_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT,'account_deleted'); END;
CREATE TRIGGER deleted_user_insert_account_requests BEFORE INSERT ON account_requests
WHEN (SELECT deleted_at FROM users WHERE id=NEW.user_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT,'account_deleted'); END;
CREATE TRIGGER deleted_user_insert_policy_acceptances BEFORE INSERT ON policy_acceptances
WHEN (SELECT deleted_at FROM users WHERE id=NEW.user_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT,'account_deleted'); END;
CREATE TRIGGER deleted_user_insert_contribution_acceptances BEFORE INSERT ON contribution_acceptances
WHEN (SELECT deleted_at FROM users WHERE id=NEW.user_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT,'account_deleted'); END;
CREATE TRIGGER deleted_user_insert_owner_reviews BEFORE INSERT ON owner_reviews
WHEN (SELECT deleted_at FROM users WHERE id=NEW.requester_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT,'account_deleted'); END;
CREATE TRIGGER deleted_user_insert_payment_orders BEFORE INSERT ON payment_orders
WHEN (SELECT deleted_at FROM users WHERE id=NEW.user_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT,'account_deleted'); END;
CREATE TRIGGER deleted_user_insert_billing_requests BEFORE INSERT ON billing_requests
WHEN (SELECT deleted_at FROM users WHERE id=NEW.user_id) IS NOT NULL
BEGIN SELECT RAISE(ABORT,'account_deleted'); END;
