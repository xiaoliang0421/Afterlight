CREATE TABLE candidate_materials (
 task_id TEXT NOT NULL REFERENCES tasks(id), character_id TEXT NOT NULL, story_id TEXT NOT NULL REFERENCES stories(id),
 name TEXT NOT NULL, description TEXT NOT NULL, reference_image TEXT NOT NULL, voice_reference TEXT, voice_duration_ms INTEGER,
 approved_by TEXT NOT NULL REFERENCES users(id), approved_at INTEGER NOT NULL,
 PRIMARY KEY(task_id,character_id)
);
ALTER TABLE characters ADD COLUMN voice_duration_ms INTEGER;
ALTER TABLE tasks ADD COLUMN material_snapshot_json TEXT;
CREATE TABLE character_material_versions (
 id TEXT PRIMARY KEY, story_id TEXT NOT NULL REFERENCES stories(id), character_id TEXT NOT NULL, reference_image TEXT NOT NULL,
 voice_reference TEXT, voice_duration_ms INTEGER, approved_by TEXT NOT NULL REFERENCES users(id), approved_at INTEGER NOT NULL
);
CREATE TRIGGER publish_candidate_materials AFTER INSERT ON characters WHEN NEW.introduced_version>0 BEGIN
 UPDATE characters SET reference_image=(SELECT json_extract(m.value,'$.referenceImage') FROM tasks t,json_each(t.material_snapshot_json,'$.characters') m WHERE t.story_id=NEW.story_id AND t.base_version+1=NEW.introduced_version AND t.status='Published' AND json_extract(m.value,'$.id')=NEW.id LIMIT 1),
 voice_reference=(SELECT json_extract(m.value,'$.voiceReference') FROM tasks t,json_each(t.material_snapshot_json,'$.characters') m WHERE t.story_id=NEW.story_id AND t.base_version+1=NEW.introduced_version AND t.status='Published' AND json_extract(m.value,'$.id')=NEW.id LIMIT 1),
 voice_duration_ms=(SELECT json_extract(m.value,'$.voiceDurationMs') FROM tasks t,json_each(t.material_snapshot_json,'$.characters') m WHERE t.story_id=NEW.story_id AND t.base_version+1=NEW.introduced_version AND t.status='Published' AND json_extract(m.value,'$.id')=NEW.id LIMIT 1)
 WHERE story_id=NEW.story_id AND id=NEW.id;
END;
