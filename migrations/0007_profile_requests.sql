ALTER TABLE users ADD COLUMN nickname_key TEXT NOT NULL DEFAULT '';
UPDATE users SET nickname_key=lower(display_name) WHERE display_name!='';
CREATE UNIQUE INDEX unique_public_nickname ON users(nickname_key) WHERE nickname_key!='' AND deleted_at IS NULL;
CREATE TABLE account_requests(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),kind TEXT NOT NULL CHECK(kind='deletion'),reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','cancelled','resolved')),created_at INTEGER NOT NULL,resolved_at INTEGER);
CREATE UNIQUE INDEX one_open_account_request ON account_requests(user_id,kind) WHERE status='open';
