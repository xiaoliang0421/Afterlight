CREATE TABLE policy_acceptances (
 user_id TEXT NOT NULL REFERENCES users(id),
 version TEXT NOT NULL,
 accepted_at INTEGER NOT NULL,
 terms_accepted INTEGER NOT NULL CHECK(terms_accepted=1),
 privacy_acknowledged INTEGER NOT NULL CHECK(privacy_acknowledged=1),
 PRIMARY KEY(user_id,version)
);
