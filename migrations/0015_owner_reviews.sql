ALTER TABLE tasks ADD COLUMN plan_revision INTEGER NOT NULL DEFAULT 0;
ALTER TABLE tasks ADD COLUMN owner_review_id TEXT;
ALTER TABLE tasks ADD COLUMN owner_review_status TEXT;
ALTER TABLE tasks ADD COLUMN owner_review_note TEXT;

CREATE TABLE owner_reviews (
 id TEXT PRIMARY KEY,
 task_id TEXT NOT NULL REFERENCES tasks(id),
 story_id TEXT NOT NULL REFERENCES stories(id),
 requester_id TEXT NOT NULL REFERENCES users(id),
 plan_revision INTEGER NOT NULL,
 plan_json TEXT NOT NULL,
 base_version INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','expired','withdrawn')),
 note TEXT NOT NULL DEFAULT '',
 decided_by TEXT REFERENCES users(id),
 created_at INTEGER NOT NULL,
 decided_at INTEGER,
 UNIQUE(task_id,plan_revision)
);
CREATE INDEX owner_reviews_inbox ON owner_reviews(story_id,status,created_at);

CREATE TRIGGER owner_review_request_guard BEFORE INSERT ON owner_reviews BEGIN
 SELECT (CASE WHEN NEW.status!='pending' OR NEW.decided_by IS NOT NULL OR NOT EXISTS(
  SELECT 1 FROM tasks t JOIN stories s ON s.id=t.story_id WHERE t.id=NEW.task_id
  AND t.story_id=NEW.story_id AND t.user_id=NEW.requester_id
  AND t.status IN ('Draft','NeedsReview') AND t.preview_lock IS NULL
  AND t.provider_attempt_id IS NULL AND t.provider_request_id IS NULL
  AND t.plan_json=NEW.plan_json AND t.plan_revision=NEW.plan_revision
  AND t.base_version=NEW.base_version AND s.version=NEW.base_version
  AND COALESCE(json_array_length(t.plan_json,'$.majorChanges'),0)>0
  AND COALESCE(json_extract(t.plan_json,'$.rejected'),0)=0
 ) THEN RAISE(ABORT,'owner_review_changed') END);
 SELECT (CASE WHEN EXISTS(SELECT 1 FROM owner_reviews WHERE story_id=NEW.story_id AND requester_id=NEW.requester_id AND status='pending') THEN RAISE(ABORT,'owner_review_pending') END);
 SELECT (CASE WHEN (SELECT COUNT(*) FROM owner_reviews WHERE story_id=NEW.story_id AND status='pending')>=20 THEN RAISE(ABORT,'owner_review_full') END);
END;
CREATE TRIGGER owner_review_requested AFTER INSERT ON owner_reviews BEGIN
 UPDATE tasks SET status='NeedsReview',owner_review_id=NEW.id,owner_review_status='pending',owner_review_note='',reason='Waiting for the story creator’s decision. No generation credit is reserved.',updated_at=NEW.created_at WHERE id=NEW.task_id;
 INSERT INTO notifications SELECT NEW.id||':request',owner_id,NEW.story_id,NEW.task_id,'A proposed major story change needs your decision.',NULL,NEW.created_at FROM stories WHERE id=NEW.story_id;
END;
CREATE TRIGGER owner_review_immutable BEFORE UPDATE ON owner_reviews WHEN
 NEW.id!=OLD.id OR NEW.task_id!=OLD.task_id OR NEW.story_id!=OLD.story_id OR NEW.requester_id!=OLD.requester_id
 OR NEW.plan_revision!=OLD.plan_revision OR NEW.plan_json!=OLD.plan_json OR NEW.base_version!=OLD.base_version
 OR NEW.created_at!=OLD.created_at OR OLD.status!='pending'
 BEGIN SELECT RAISE(ABORT,'owner_review_immutable'); END;
CREATE TRIGGER owner_review_decision_guard BEFORE UPDATE ON owner_reviews WHEN NEW.status IN ('approved','rejected') BEGIN
 SELECT (CASE WHEN NEW.decided_at IS NULL OR length(trim(NEW.note))<10 OR NOT EXISTS(
  SELECT 1 FROM tasks t JOIN stories s ON s.id=t.story_id WHERE t.id=NEW.task_id AND s.owner_id=NEW.decided_by
  AND s.version=NEW.base_version AND t.base_version=NEW.base_version AND t.plan_revision=NEW.plan_revision
  AND t.plan_json=NEW.plan_json AND t.status IN ('Draft','NeedsReview') AND t.preview_lock IS NULL
 ) THEN RAISE(ABORT,'owner_review_changed') END);
END;
CREATE TRIGGER owner_review_decided AFTER UPDATE OF status ON owner_reviews BEGIN
 UPDATE tasks SET owner_review_status=NEW.status,owner_review_note=NEW.note,updated_at=COALESCE(NEW.decided_at,updated_at),reason= (CASE NEW.status WHEN 'approved' THEN 'The story creator approved this plan. Confirm it before joining the queue.' WHEN 'rejected' THEN 'The story creator declined this plan. You can withdraw it and propose another idea.' WHEN 'expired' THEN 'The story or plan changed. Preview the scene again before requesting a new decision.' ELSE reason END) WHERE id=NEW.task_id AND owner_review_id=NEW.id;
 INSERT INTO notifications SELECT NEW.id||':'||NEW.status,NEW.requester_id,NEW.story_id,NEW.task_id,
  (CASE NEW.status WHEN 'approved' THEN 'Your story change was approved. Confirm the plan to join the queue.' WHEN 'rejected' THEN 'The story creator left a decision on your proposal.' ELSE 'Your story-change request is no longer current.' END),NULL,COALESCE(NEW.decided_at,NEW.created_at)
  WHERE NEW.status!='withdrawn';
END;
CREATE TRIGGER owner_review_plan_changed AFTER UPDATE OF plan_json,base_version ON tasks
 WHEN NEW.plan_json IS NOT OLD.plan_json OR NEW.base_version!=OLD.base_version BEGIN
 UPDATE tasks SET plan_revision=OLD.plan_revision+1,owner_review_id=NULL,owner_review_status=NULL,owner_review_note=NULL WHERE id=NEW.id;
 UPDATE owner_reviews SET status='expired' WHERE task_id=NEW.id AND status='pending';
END;
CREATE TRIGGER owner_review_withdrawn AFTER UPDATE OF status ON tasks WHEN NEW.status IN ('Cancelled','Failed') BEGIN
 UPDATE owner_reviews SET status='withdrawn' WHERE task_id=NEW.id AND status='pending';
END;
CREATE TRIGGER owner_review_canon_changed AFTER UPDATE OF version ON stories WHEN NEW.version!=OLD.version BEGIN
 UPDATE owner_reviews SET status='expired' WHERE story_id=NEW.id AND base_version!=NEW.version AND status='pending';
 UPDATE tasks SET owner_review_status='expired',reason='The story advanced. Preview the scene again before continuing.'
  WHERE story_id=NEW.id AND base_version!=NEW.version AND owner_review_status='approved' AND provider_attempt_id IS NULL AND status IN ('Draft','NeedsReview','Queued','Preparing');
END;
-- Check the stored decision, never a client flag or the denormalized display columns.
CREATE TRIGGER owner_review_generation_guard BEFORE UPDATE OF status ON tasks
 WHEN NEW.status IN ('Queued','Generating') AND NEW.status!=OLD.status
 AND COALESCE(json_array_length(NEW.plan_json,'$.majorChanges'),0)>0 BEGIN
 SELECT (CASE WHEN NOT EXISTS(
  SELECT 1 FROM owner_reviews r JOIN stories s ON s.id=r.story_id
  WHERE r.task_id=NEW.id AND r.status='approved' AND r.decided_by=s.owner_id
  AND r.base_version=NEW.base_version AND s.version=NEW.base_version
  AND r.plan_revision=NEW.plan_revision AND r.plan_json=NEW.plan_json
 ) THEN RAISE(ABORT,'owner_approval_required') END);
END;
