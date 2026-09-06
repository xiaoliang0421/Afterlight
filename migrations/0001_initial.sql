PRAGMA foreign_keys = ON;
CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT UNIQUE, display_name TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user','admin')), created_at INTEGER NOT NULL, deleted_at INTEGER);
CREATE TABLE sessions (token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX sessions_user ON sessions(user_id);
CREATE TABLE oauth_states (state_hash TEXT PRIMARY KEY, verifier TEXT NOT NULL, return_path TEXT NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE settings (id INTEGER PRIMARY KEY CHECK(id=1), generation_enabled INTEGER NOT NULL DEFAULT 0, daily_credits INTEGER NOT NULL DEFAULT 3 CHECK(daily_credits BETWEEN 0 AND 50), daily_budget_cents INTEGER NOT NULL DEFAULT 0, monthly_budget_cents INTEGER NOT NULL DEFAULT 0, task_reserve_cents INTEGER NOT NULL DEFAULT 150, max_queue_per_story INTEGER NOT NULL DEFAULT 20, max_stories_per_user INTEGER NOT NULL DEFAULT 3, policy_version TEXT NOT NULL DEFAULT 'free-v1');
INSERT INTO settings(id) VALUES(1);
CREATE TABLE provider_wallet (id INTEGER PRIMARY KEY CHECK(id=1), balance_cents INTEGER NOT NULL DEFAULT 0, checked_at INTEGER NOT NULL DEFAULT 0, reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK(reserved_cents>=0), debited_cents INTEGER NOT NULL DEFAULT 0 CHECK(debited_cents>=0));
INSERT INTO provider_wallet(id) VALUES(1);
CREATE TABLE stories (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE, owner_id TEXT NOT NULL REFERENCES users(id), title TEXT NOT NULL, logline TEXT NOT NULL, genre TEXT NOT NULL, world_rules TEXT NOT NULL, visual_style TEXT NOT NULL, language TEXT NOT NULL DEFAULT 'en' CHECK(language='en'), status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','open','paused')), version INTEGER NOT NULL DEFAULT 0, next_sequence INTEGER NOT NULL DEFAULT 1, active_task_id TEXT, cover_url TEXT NOT NULL DEFAULT '/art/last-light.png', fixture INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
CREATE TABLE characters (id TEXT NOT NULL, story_id TEXT NOT NULL REFERENCES stories(id), name TEXT NOT NULL, description TEXT NOT NULL, state TEXT NOT NULL, reference_image TEXT, voice_reference TEXT, introduced_version INTEGER NOT NULL DEFAULT 0, material_version INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(story_id,id), UNIQUE(story_id,name));
CREATE TABLE episodes (id TEXT PRIMARY KEY, story_id TEXT NOT NULL REFERENCES stories(id), number INTEGER NOT NULL, title TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','complete')), duration_ms INTEGER NOT NULL DEFAULT 0, UNIQUE(story_id,number), UNIQUE(story_id,id));
CREATE TABLE credit_accounts (user_id TEXT NOT NULL REFERENCES users(id), period TEXT NOT NULL, limit_units INTEGER NOT NULL, reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0), spent INTEGER NOT NULL DEFAULT 0 CHECK(spent>=0), PRIMARY KEY(user_id,period));
CREATE TABLE budget_periods (kind TEXT NOT NULL CHECK(kind IN ('day','month')), period TEXT NOT NULL, limit_cents INTEGER NOT NULL, reserved_cents INTEGER NOT NULL DEFAULT 0 CHECK(reserved_cents>=0), spent_cents INTEGER NOT NULL DEFAULT 0 CHECK(spent_cents>=0), PRIMARY KEY(kind,period));
CREATE TABLE tasks (
 id TEXT PRIMARY KEY, story_id TEXT NOT NULL REFERENCES stories(id), user_id TEXT NOT NULL REFERENCES users(id),
 prompt_original TEXT NOT NULL, plan_json TEXT, approved_plan_json TEXT, base_version INTEGER NOT NULL, queue_sequence INTEGER,
 status TEXT NOT NULL DEFAULT 'Draft' CHECK(status IN ('Draft','NeedsReview','Queued','Preparing','Generating','Checking','NeedsModeration','Packaging','Published','Cancelled','Failed','ReconciliationNeeded')),
 reason TEXT NOT NULL DEFAULT '', idempotency_key TEXT NOT NULL, policy_version TEXT NOT NULL DEFAULT 'free-v1',
 quota_period TEXT, budget_day TEXT, budget_month TEXT, reserved_cents INTEGER NOT NULL DEFAULT 0, reservation_active INTEGER NOT NULL DEFAULT 0,
 recorded_cost_cents INTEGER NOT NULL DEFAULT 0, cost_status TEXT NOT NULL DEFAULT 'unbilled',
 provider_request_id TEXT, provider_attempt_id TEXT, provider_result_url TEXT, provider_status_url TEXT,
 media_key TEXT, captions_key TEXT, stream_id TEXT, media_duration_ms INTEGER, media_ready INTEGER NOT NULL DEFAULT 0,
 approved_summary TEXT, approved_events_json TEXT, approved_characters_json TEXT, approved_new_characters_json TEXT,
 reviewer_id TEXT REFERENCES users(id), workflow_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
 UNIQUE(user_id,idempotency_key), UNIQUE(story_id,queue_sequence)
);
CREATE INDEX tasks_queue ON tasks(story_id,status,queue_sequence);
CREATE INDEX tasks_user ON tasks(user_id,created_at DESC);
CREATE TABLE scenes (id TEXT PRIMARY KEY, story_id TEXT NOT NULL REFERENCES stories(id), episode_id TEXT NOT NULL, task_id TEXT UNIQUE REFERENCES tasks(id), version INTEGER NOT NULL, title TEXT NOT NULL, summary TEXT NOT NULL, media_key TEXT NOT NULL, captions_key TEXT NOT NULL, stream_id TEXT, thumbnail_url TEXT NOT NULL, duration_ms INTEGER NOT NULL CHECK(duration_ms>0), start_ms INTEGER NOT NULL CHECK(start_ms>=0), prompt_original TEXT NOT NULL, english_prompt TEXT NOT NULL, author_id TEXT NOT NULL REFERENCES users(id), source TEXT NOT NULL DEFAULT 'user' CHECK(source IN ('user','studio')), fixture INTEGER NOT NULL DEFAULT 0, hidden INTEGER NOT NULL DEFAULT 0, published_at INTEGER NOT NULL, UNIQUE(story_id,version), FOREIGN KEY(story_id,episode_id) REFERENCES episodes(story_id,id));
CREATE TABLE canon_events (id INTEGER PRIMARY KEY AUTOINCREMENT, story_id TEXT NOT NULL REFERENCES stories(id), scene_id TEXT NOT NULL REFERENCES scenes(id), version INTEGER NOT NULL, description TEXT NOT NULL);
CREATE INDEX canon_story ON canon_events(story_id,version);
CREATE TABLE ledger (id TEXT PRIMARY KEY, task_id TEXT REFERENCES tasks(id), user_id TEXT REFERENCES users(id), kind TEXT NOT NULL, units INTEGER NOT NULL DEFAULT 0, cents INTEGER NOT NULL DEFAULT 0, policy_version TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE notifications (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), story_id TEXT REFERENCES stories(id), task_id TEXT REFERENCES tasks(id), message TEXT NOT NULL, read_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE outbox (id TEXT PRIMARY KEY, story_id TEXT NOT NULL REFERENCES stories(id), payload TEXT NOT NULL, sent_at INTEGER, created_at INTEGER NOT NULL);
CREATE TABLE favorites (user_id TEXT NOT NULL REFERENCES users(id), story_id TEXT NOT NULL REFERENCES stories(id), PRIMARY KEY(user_id,story_id));
CREATE TABLE watch_progress (user_id TEXT NOT NULL REFERENCES users(id), story_id TEXT NOT NULL REFERENCES stories(id), episode_id TEXT NOT NULL, time_ms INTEGER NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY(user_id,story_id), FOREIGN KEY(story_id,episode_id) REFERENCES episodes(story_id,id));
CREATE TABLE reports (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), story_id TEXT NOT NULL REFERENCES stories(id), scene_id TEXT REFERENCES scenes(id), reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL);
CREATE TABLE audit_log (id TEXT PRIMARY KEY, actor_id TEXT REFERENCES users(id), action TEXT NOT NULL, target_id TEXT NOT NULL, detail TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);

-- Admission is a single D1 transaction. A second request cannot promise the same money or credit.
CREATE TRIGGER task_admission BEFORE UPDATE OF status ON tasks WHEN NEW.status='Queued' AND OLD.status IN ('Draft','NeedsReview') BEGIN
 SELECT (CASE WHEN (SELECT generation_enabled FROM settings WHERE id=1)!=1 THEN RAISE(ABORT,'generation_paused') END);
 SELECT (CASE WHEN (SELECT status FROM stories WHERE id=NEW.story_id)!='open' THEN RAISE(ABORT,'story_paused') END);
 SELECT (CASE WHEN NEW.plan_json IS NULL OR NEW.approved_plan_json IS NULL THEN RAISE(ABORT,'plan_required') END);
 SELECT (CASE WHEN NEW.policy_version!='free-v1' THEN RAISE(ABORT,'payment_disabled') END);
 SELECT (CASE WHEN EXISTS(SELECT 1 FROM tasks WHERE story_id=NEW.story_id AND user_id=NEW.user_id AND id!=NEW.id AND reservation_active=1) THEN RAISE(ABORT,'already_in_queue') END);
 SELECT (CASE WHEN (SELECT count(*) FROM tasks WHERE story_id=NEW.story_id AND reservation_active=1)>=(SELECT max_queue_per_story FROM settings WHERE id=1) THEN RAISE(ABORT,'queue_full') END);
 SELECT (CASE WHEN COALESCE((SELECT limit_units-reserved-spent FROM credit_accounts WHERE user_id=NEW.user_id AND period=NEW.quota_period),0)<1 THEN RAISE(ABORT,'credits_exhausted') END);
 SELECT (CASE WHEN COALESCE((SELECT limit_cents-reserved_cents-spent_cents FROM budget_periods WHERE kind='day' AND period=NEW.budget_day),0)<NEW.reserved_cents THEN RAISE(ABORT,'capacity_full') END);
 SELECT (CASE WHEN COALESCE((SELECT limit_cents-reserved_cents-spent_cents FROM budget_periods WHERE kind='month' AND period=NEW.budget_month),0)<NEW.reserved_cents THEN RAISE(ABORT,'capacity_full') END);
 SELECT (CASE WHEN (SELECT checked_at FROM provider_wallet WHERE id=1)<NEW.updated_at-300000 THEN RAISE(ABORT,'balance_stale') END);
 SELECT (CASE WHEN (SELECT balance_cents-reserved_cents-debited_cents FROM provider_wallet WHERE id=1)<NEW.reserved_cents THEN RAISE(ABORT,'provider_capacity') END);
END;
CREATE TRIGGER task_reserve AFTER UPDATE OF status ON tasks WHEN NEW.status='Queued' AND OLD.status IN ('Draft','NeedsReview') BEGIN
 UPDATE credit_accounts SET reserved=reserved+1 WHERE user_id=NEW.user_id AND period=NEW.quota_period;
 UPDATE budget_periods SET reserved_cents=reserved_cents+NEW.reserved_cents WHERE (kind='day' AND period=NEW.budget_day) OR (kind='month' AND period=NEW.budget_month);
 UPDATE provider_wallet SET reserved_cents=reserved_cents+NEW.reserved_cents WHERE id=1;
 UPDATE tasks SET reservation_active=1,queue_sequence=(SELECT next_sequence FROM stories WHERE id=NEW.story_id) WHERE id=NEW.id;
 UPDATE stories SET next_sequence=next_sequence+1 WHERE id=NEW.story_id;
 INSERT INTO ledger VALUES(NEW.id||':reserve:'||NEW.updated_at,NEW.id,NEW.user_id,'reserve',1,NEW.reserved_cents,NEW.policy_version,NEW.updated_at);
END;
CREATE TRIGGER task_settle AFTER UPDATE OF status ON tasks WHEN OLD.reservation_active=1 AND NEW.status IN ('Published','Cancelled','Failed','NeedsReview') BEGIN
 UPDATE credit_accounts SET reserved=reserved-1,spent=spent+ (CASE WHEN NEW.status='Published' THEN 1 ELSE 0 END) WHERE user_id=NEW.user_id AND period=NEW.quota_period;
 UPDATE budget_periods SET reserved_cents=reserved_cents-NEW.reserved_cents,spent_cents=spent_cents+NEW.recorded_cost_cents WHERE (kind='day' AND period=NEW.budget_day) OR (kind='month' AND period=NEW.budget_month);
 UPDATE provider_wallet SET reserved_cents=reserved_cents-NEW.reserved_cents,debited_cents=debited_cents+NEW.recorded_cost_cents WHERE id=1;
 UPDATE tasks SET reservation_active=0 WHERE id=NEW.id;
 UPDATE stories SET active_task_id=NULL WHERE id=NEW.story_id AND active_task_id=NEW.id;
 INSERT INTO ledger VALUES(NEW.id||':settle:'||NEW.updated_at,NEW.id,NEW.user_id, (CASE WHEN NEW.status='Published' THEN 'consume' ELSE 'release' END), (CASE WHEN NEW.status='Published' THEN 1 ELSE 0 END),NEW.recorded_cost_cents,NEW.policy_version,NEW.updated_at);
 INSERT INTO notifications VALUES(NEW.id||':'||NEW.status||':'||NEW.updated_at,NEW.user_id,NEW.story_id,NEW.id, (CASE NEW.status WHEN 'Published' THEN 'Your scene is now part of the story.' WHEN 'NeedsReview' THEN 'The story has changed. Review the updated scene before rejoining.' ELSE 'Your creation credit has been returned.' END),NULL,NEW.updated_at);
END;
CREATE TRIGGER publish_guard BEFORE UPDATE OF status ON tasks WHEN NEW.status='Published' AND OLD.status!='Published' BEGIN
 SELECT (CASE WHEN OLD.status NOT IN ('NeedsModeration','Packaging') OR NEW.media_ready!=1 OR NEW.media_key IS NULL OR NEW.media_duration_ms<=0 OR NEW.reviewer_id IS NULL OR NEW.approved_summary IS NULL THEN RAISE(ABORT,'media_not_approved') END);
 SELECT (CASE WHEN (SELECT version FROM stories WHERE id=NEW.story_id)!=NEW.base_version OR (SELECT active_task_id FROM stories WHERE id=NEW.story_id) IS NOT NEW.id THEN RAISE(ABORT,'story_version_conflict') END);
 SELECT (CASE WHEN NEW.reservation_active!=1 THEN RAISE(ABORT,'reservation_required') END);
END;
CREATE TRIGGER publish_scene AFTER UPDATE OF status ON tasks WHEN NEW.status='Published' AND OLD.status!='Published' BEGIN
 INSERT INTO episodes(id,story_id,number,title)
 SELECT NEW.story_id||':episode:'||(COALESCE(MAX(number),0)+1),NEW.story_id,COALESCE(MAX(number),0)+1,'Chapter '||(COALESCE(MAX(number),0)+1) FROM episodes WHERE story_id=NEW.story_id
 HAVING NOT EXISTS(SELECT 1 FROM episodes WHERE story_id=NEW.story_id AND status='open');
 INSERT INTO scenes(id,story_id,episode_id,task_id,version,title,summary,media_key,captions_key,stream_id,thumbnail_url,duration_ms,start_ms,prompt_original,english_prompt,author_id,fixture,published_at)
 SELECT NEW.id,NEW.story_id,e.id,NEW.id,NEW.base_version+1,json_extract(NEW.plan_json,'$.title'),NEW.approved_summary,NEW.media_key,COALESCE(NEW.captions_key,''),NEW.stream_id,s.cover_url,NEW.media_duration_ms,e.duration_ms,NEW.prompt_original,json_extract(NEW.plan_json,'$.englishPrompt'),NEW.user_id,s.fixture,NEW.updated_at FROM episodes e JOIN stories s ON s.id=e.story_id WHERE e.story_id=NEW.story_id AND e.status='open';
 INSERT INTO canon_events(story_id,scene_id,version,description) SELECT NEW.story_id,NEW.id,NEW.base_version+1,value FROM json_each(COALESCE(NEW.approved_events_json,'[]'));
 INSERT INTO characters(id,story_id,name,description,state,introduced_version)
 SELECT json_extract(value,'$.id'),NEW.story_id,json_extract(value,'$.name'),json_extract(value,'$.description'),json_extract(value,'$.state'),NEW.base_version+1 FROM json_each(COALESCE(NEW.approved_new_characters_json,'[]'));
 UPDATE characters SET state=(SELECT json_extract(value,'$.state') FROM json_each(COALESCE(NEW.approved_characters_json,'[]')) WHERE json_extract(value,'$.id')=characters.id) WHERE story_id=NEW.story_id AND id IN (SELECT json_extract(value,'$.id') FROM json_each(COALESCE(NEW.approved_characters_json,'[]')));
 UPDATE episodes SET duration_ms=duration_ms+NEW.media_duration_ms,status= (CASE WHEN duration_ms+NEW.media_duration_ms>=180000 THEN 'complete' ELSE 'open' END) WHERE story_id=NEW.story_id AND status='open';
 UPDATE stories SET version=version+1,active_task_id=NULL,updated_at=NEW.updated_at WHERE id=NEW.story_id;
 INSERT INTO outbox VALUES(NEW.id||':published',NEW.story_id,json_object('type','scene.published','sceneId',NEW.id,'version',NEW.base_version+1),NULL,NEW.updated_at);
END;
