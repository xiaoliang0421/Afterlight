CREATE TABLE character_history (
 story_id TEXT NOT NULL REFERENCES stories(id), character_id TEXT NOT NULL,
 version INTEGER NOT NULL, name TEXT NOT NULL, description TEXT NOT NULL, state TEXT NOT NULL,
 introduced_version INTEGER NOT NULL, source_scene_id TEXT REFERENCES scenes(id),
 PRIMARY KEY(story_id,character_id,version), FOREIGN KEY(story_id,character_id) REFERENCES characters(story_id,id)
);
-- Older installations only know the current state; never invent earlier snapshots.
INSERT INTO character_history SELECT c.story_id,c.id,s.version,c.name,c.description,c.state,c.introduced_version,NULL FROM characters c JOIN stories s ON s.id=c.story_id;
CREATE TRIGGER character_initial_history AFTER INSERT ON characters BEGIN
 INSERT INTO character_history VALUES(NEW.story_id,NEW.id,MAX(NEW.introduced_version,(SELECT version FROM stories WHERE id=NEW.story_id)),NEW.name,NEW.description,NEW.state,NEW.introduced_version,NULL);
END;
CREATE TABLE story_archives (
 id TEXT PRIMARY KEY, story_id TEXT NOT NULL REFERENCES stories(id), scene_id TEXT NOT NULL REFERENCES scenes(id),
 task_id TEXT NOT NULL REFERENCES tasks(id), version INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','building','review','approved','failed','rejected')),
 input_json TEXT, draft_json TEXT, approved_json TEXT, reason TEXT NOT NULL DEFAULT '',
 model TEXT, reviewer_id TEXT REFERENCES users(id), created_at INTEGER NOT NULL, started_at INTEGER, reviewed_at INTEGER,
 UNIQUE(story_id,version)
);
CREATE INDEX archive_queue ON story_archives(status,created_at);
-- The publication outbox is inserted after all canonical character changes, inside the same transaction.
CREATE TRIGGER published_character_history AFTER INSERT ON outbox WHEN json_extract(NEW.payload,'$.type')='scene.published' BEGIN
 INSERT OR REPLACE INTO character_history
 SELECT c.story_id,c.id,json_extract(NEW.payload,'$.version'),c.name,c.description,c.state,c.introduced_version,json_extract(NEW.payload,'$.sceneId') FROM characters c WHERE c.story_id=NEW.story_id;
 INSERT INTO story_archives(id,story_id,scene_id,task_id,version,created_at)
 VALUES(NEW.id||':archive',NEW.story_id,json_extract(NEW.payload,'$.sceneId'),json_extract(NEW.payload,'$.sceneId'),json_extract(NEW.payload,'$.version'),NEW.created_at);
END;
