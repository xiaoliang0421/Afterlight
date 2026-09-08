
-- Synthetic development pricing and wallets; never run against hosted data.
UPDATE settings SET text_points=5,uploads_enabled=1;
INSERT OR IGNORE INTO paid_credit_accounts(user_id,balance) VALUES('dev-creator',100),('dev-studio',100);
INSERT OR IGNORE INTO users(id,email,display_name,role,created_at) VALUES('dev-newcomer','newcomer@example.invalid','','user',1);
INSERT OR IGNORE INTO paid_credit_accounts(user_id,balance) VALUES('dev-newcomer',100);
