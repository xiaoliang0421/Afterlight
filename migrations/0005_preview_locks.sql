ALTER TABLE tasks ADD COLUMN preview_lock TEXT;
ALTER TABLE tasks ADD COLUMN preview_locked_at INTEGER;
CREATE UNIQUE INDEX one_open_episode_per_story ON episodes(story_id) WHERE status='open';
