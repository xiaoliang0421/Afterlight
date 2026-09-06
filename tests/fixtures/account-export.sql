-- Isolated integration data only. All token values are deliberate test sentinels.
INSERT INTO user(id,name,email,createdAt,updatedAt) VALUES
 ('dev-creator','Creator sign-in profile','creator@example.invalid',1,1),
 ('dev-studio','PRIVATE_OTHER_PROFILE','studio@example.invalid',1,1);
INSERT INTO account(id,accountId,providerId,userId,accessToken,refreshToken,idToken,password,createdAt,updatedAt) VALUES
 ('export-own-account','own-google-id','google','dev-creator','DO_NOT_EXPORT_ACCESS','DO_NOT_EXPORT_REFRESH','DO_NOT_EXPORT_ID','DO_NOT_EXPORT_PASSWORD',1,1),
 ('export-other-account','PRIVATE_OTHER_GOOGLE_ID','google','dev-studio','OTHER_ACCESS_SENTINEL',NULL,NULL,NULL,1,1);
INSERT INTO session(id,expiresAt,token,createdAt,updatedAt,ipAddress,userAgent,userId) VALUES
 ('export-own-session',2,'DO_NOT_EXPORT_SESSION',1,1,'192.0.2.1','Integration browser','dev-creator'),
 ('export-other-session',2,'OTHER_SESSION_SENTINEL',1,1,'192.0.2.2','PRIVATE_OTHER_AGENT','dev-studio');
WITH RECURSIVE n(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM n WHERE i<205)
 INSERT INTO notifications(id,user_id,story_id,task_id,message,created_at)
 SELECT 'export-message-'||i,'dev-creator',NULL,NULL,'Export notification '||i,i FROM n;
INSERT INTO notifications(id,user_id,story_id,task_id,message,created_at) VALUES
 ('export-other-message','dev-studio',NULL,NULL,'PRIVATE_OTHER_NOTIFICATION',1);
