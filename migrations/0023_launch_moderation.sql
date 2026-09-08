-- Invitation-only creation and separately reviewed public metadata.
ALTER TABLE settings ADD COLUMN invitation_only INTEGER NOT NULL DEFAULT 1 CHECK(invitation_only IN (0,1));
ALTER TABLE users ADD COLUMN contribution_access TEXT NOT NULL DEFAULT 'none' CHECK(contribution_access IN ('none','member','host','suspended'));
ALTER TABLE users ADD COLUMN public_name TEXT NOT NULL DEFAULT '';
ALTER TABLE users ADD COLUMN name_review_note TEXT NOT NULL DEFAULT '';
ALTER TABLE stories ADD COLUMN review_status TEXT NOT NULL DEFAULT 'pending' CHECK(review_status IN ('pending','approved','rejected','blocked'));
ALTER TABLE stories ADD COLUMN review_note TEXT NOT NULL DEFAULT '';
ALTER TABLE stories ADD COLUMN publication_hold INTEGER NOT NULL DEFAULT 0 CHECK(publication_hold IN (0,1));
-- Retain names and worlds already exposed by an approved scene. New drafts stay private.
UPDATE users SET public_name=display_name WHERE EXISTS(SELECT 1 FROM scenes WHERE author_id=users.id AND hidden=0);
UPDATE users SET contribution_access='host' WHERE role='admin' AND deleted_at IS NULL;
UPDATE stories SET review_status='approved' WHERE status!='draft' AND EXISTS(SELECT 1 FROM scenes WHERE story_id=stories.id AND hidden=0);
CREATE TRIGGER story_open_review BEFORE UPDATE OF status ON stories WHEN NEW.status='open' AND OLD.status!='open' BEGIN
 SELECT (CASE WHEN NEW.review_status!='approved' OR NEW.publication_hold=1 THEN RAISE(ABORT,'story_review_required') END);
END;
CREATE TRIGGER story_initial_review BEFORE INSERT ON stories WHEN NEW.status!='draft' AND (SELECT invitation_only FROM settings WHERE id=1)=1 AND NEW.review_status!='approved'
BEGIN SELECT RAISE(ABORT,'story_review_required'); END;
CREATE TRIGGER story_metadata_changed AFTER UPDATE OF title,logline,world_rules,visual_style,cover_url,genre ON stories WHEN
 NEW.title!=OLD.title OR NEW.logline!=OLD.logline OR NEW.world_rules!=OLD.world_rules OR NEW.visual_style!=OLD.visual_style OR NEW.cover_url!=OLD.cover_url OR NEW.genre!=OLD.genre
BEGIN UPDATE stories SET review_status='pending',status='draft' WHERE id=NEW.id; END;
CREATE TRIGGER invitation_story BEFORE INSERT ON stories WHEN (SELECT invitation_only FROM settings WHERE id=1)=1 AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.owner_id AND contribution_access='host' AND deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'host_invitation_required'); END;
CREATE TRIGGER invitation_task BEFORE INSERT ON tasks WHEN (SELECT invitation_only FROM settings WHERE id=1)=1 AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND contribution_access IN ('member','host') AND deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'invitation_required'); END;
CREATE TRIGGER invitation_proposal BEFORE INSERT ON story_proposals WHEN (SELECT invitation_only FROM settings WHERE id=1)=1 AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.author_id AND contribution_access IN ('member','host') AND deleted_at IS NULL)
BEGIN SELECT RAISE(ABORT,'invitation_required'); END;
CREATE TRIGGER invitation_task_run BEFORE UPDATE OF status,provider_attempt_id ON tasks WHEN
 (NEW.status IN ('Queued','Published') AND NEW.status!=OLD.status) OR (NEW.provider_attempt_id IS NOT NULL AND OLD.provider_attempt_id IS NULL)
BEGIN
 SELECT (CASE WHEN EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND contribution_access='suspended') OR ((SELECT invitation_only FROM settings WHERE id=1)=1 AND NOT EXISTS(SELECT 1 FROM users WHERE id=NEW.user_id AND contribution_access IN ('member','host') AND deleted_at IS NULL)) THEN RAISE(ABORT,'invitation_required') END);
 SELECT (CASE WHEN (SELECT invitation_only FROM settings WHERE id=1)=1 AND EXISTS(SELECT 1 FROM stories WHERE id=NEW.story_id AND (review_status!='approved' OR publication_hold=1)) THEN RAISE(ABORT,'story_review_required') END);
 SELECT (CASE WHEN NEW.status='Published' AND EXISTS(SELECT 1 FROM story_proposals p JOIN users u ON u.id=p.author_id WHERE p.selected_task_id=NEW.id AND u.contribution_access='suspended') THEN RAISE(ABORT,'contributor_suspended') END);
END;
CREATE TRIGGER public_name_erased AFTER UPDATE OF deleted_at ON users WHEN NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL
BEGIN UPDATE users SET public_name='',name_review_note='',contribution_access='suspended',email=NULL,display_name='Deleted storyteller',nickname_key='' WHERE id=NEW.id; END;
CREATE TRIGGER deleted_public_profile BEFORE UPDATE OF public_name,name_review_note,contribution_access ON users WHEN OLD.deleted_at IS NOT NULL AND (NEW.public_name!='' OR NEW.name_review_note!='' OR NEW.contribution_access!='suspended')
BEGIN SELECT RAISE(ABORT,'account_deleted'); END;
