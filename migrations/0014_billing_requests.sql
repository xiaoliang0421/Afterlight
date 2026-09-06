CREATE TABLE billing_requests (
 id TEXT PRIMARY KEY, order_id TEXT NOT NULL REFERENCES payment_orders(id), user_id TEXT NOT NULL REFERENCES users(id),
 reason TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','resolved')),
 response TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, resolved_at INTEGER
);
CREATE UNIQUE INDEX one_open_billing_request ON billing_requests(order_id) WHERE status='open';
