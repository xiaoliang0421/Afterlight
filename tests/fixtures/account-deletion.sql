-- Local integration fixture only; the cookie below is a fixed test sentinel.
INSERT INTO users(id,email,display_name,created_at,nickname_key) VALUES('delete-fixture','deletion@example.invalid','Deletion test',1,'deletion test');
INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES('2426b061b0a1d8bfb3ef555a2ad545f277a9491f51797480820208859c57319d','delete-fixture',9999999999999,1);
INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES('delete-fixture','Deletion profile','deletion@example.invalid',1,1);
INSERT INTO account(id,accountId,providerId,userId,accessToken,createdAt,updatedAt) VALUES('deletion-auth','deletion-provider','google','delete-fixture','DELETION_ACCESS_SENTINEL',1,1);
