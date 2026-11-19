ALTER TABLE orders ADD COLUMN assignee_id TEXT REFERENCES user(id);
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN accepted_at INTEGER;
--> statement-breakpoint
ALTER TABLE orders ADD COLUMN completed_at INTEGER;
--> statement-breakpoint
CREATE TABLE order_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id),
  action TEXT NOT NULL CHECK (action IN ('create', 'accept', 'deliver', 'reject', 'cancel', 'requeue')),
  actor_id TEXT NOT NULL REFERENCES user(id),
  actor_name TEXT NOT NULL,
  at INTEGER NOT NULL,
  from_status TEXT CHECK (from_status IN ('PENDING', 'ACCEPTED', 'DELIVERED', 'REJECTED', 'CANCELLED')),
  to_status TEXT NOT NULL CHECK (to_status IN ('PENDING', 'ACCEPTED', 'DELIVERED', 'REJECTED', 'CANCELLED')),
  from_assignee_id TEXT REFERENCES user(id),
  assignee_id TEXT REFERENCES user(id),
  assignee_name TEXT NOT NULL DEFAULT '',
  reason TEXT
);
--> statement-breakpoint
CREATE INDEX order_history_order ON order_history(order_id, id);
--> statement-breakpoint
CREATE INDEX orders_queue ON orders(status, created_at);
--> statement-breakpoint
CREATE INDEX orders_assignee ON orders(assignee_id, status);
--> statement-breakpoint
INSERT INTO order_history (order_id, action, actor_id, actor_name, at, to_status)
SELECT orders.id, 'create', user.id, user.name, orders.created_at, 'PENDING'
FROM orders JOIN user ON user.id = orders.user_id;
--> statement-breakpoint
INSERT INTO order_history (order_id, action, actor_id, actor_name, at, from_status, to_status, reason)
SELECT orders.id, 'cancel', user.id, user.name, orders.updated_at, 'PENDING', 'CANCELLED', orders.reason
FROM orders JOIN user ON user.id = orders.user_id WHERE orders.status = 'CANCELLED';
--> statement-breakpoint
UPDATE orders SET completed_at = updated_at WHERE status IN ('DELIVERED', 'REJECTED', 'CANCELLED');
