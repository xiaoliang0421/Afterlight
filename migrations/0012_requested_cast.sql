ALTER TABLE tasks ADD COLUMN requested_character_ids_json TEXT NOT NULL DEFAULT '[]'
 CHECK(json_valid(requested_character_ids_json) AND json_type(requested_character_ids_json)='array' AND json_array_length(requested_character_ids_json)<=3);

CREATE TRIGGER validate_requested_cast BEFORE INSERT ON tasks BEGIN
 SELECT RAISE(ABORT,'invalid_requested_cast') WHERE
  (SELECT count(*) FROM json_each(NEW.requested_character_ids_json)) <>
  (SELECT count(DISTINCT c.id) FROM json_each(NEW.requested_character_ids_json) j
   JOIN characters c ON c.id=j.value AND c.story_id=NEW.story_id
   JOIN stories s ON s.id=c.story_id WHERE j.type='text' AND c.introduced_version<=s.version);
END;

CREATE TRIGGER immutable_requested_cast BEFORE UPDATE OF requested_character_ids_json ON tasks
 WHEN NEW.requested_character_ids_json<>OLD.requested_character_ids_json BEGIN
 SELECT RAISE(ABORT,'requested_cast_is_immutable');
END;
