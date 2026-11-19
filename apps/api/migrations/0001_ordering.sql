CREATE TABLE menu_item (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('tea', 'coffee', 'water', 'snack')),
  unit TEXT NOT NULL,
  available INTEGER NOT NULL CHECK (available IN (0, 1)),
  archived INTEGER NOT NULL CHECK (archived IN (0, 1))
);
--> statement-breakpoint
CREATE TABLE orders (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id),
  idempotency_key TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('PENDING', 'ACCEPTED', 'DELIVERED', 'REJECTED', 'CANCELLED')),
  floor TEXT NOT NULL,
  desk TEXT NOT NULL,
  note TEXT NOT NULL,
  reason TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX orders_user_key ON orders(user_id, idempotency_key);
--> statement-breakpoint
CREATE INDEX orders_owner_updated ON orders(user_id, updated_at);
--> statement-breakpoint
CREATE TABLE order_item (
  id TEXT PRIMARY KEY NOT NULL,
  order_id TEXT NOT NULL REFERENCES orders(id),
  item_id TEXT NOT NULL REFERENCES menu_item(id),
  name TEXT NOT NULL,
  unit TEXT NOT NULL,
  quantity INTEGER NOT NULL CHECK (quantity > 0)
);
--> statement-breakpoint
CREATE INDEX order_item_order ON order_item(order_id);
