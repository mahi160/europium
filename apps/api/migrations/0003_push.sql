CREATE TABLE push_subscription (
  endpoint TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES session(id) ON DELETE CASCADE,
  p256dh TEXT NOT NULL,
  auth TEXT NOT NULL
);
--> statement-breakpoint
CREATE INDEX push_subscription_session ON push_subscription(session_id);
--> statement-breakpoint
CREATE TABLE push_schedule (
  order_id TEXT PRIMARY KEY NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  history_id INTEGER NOT NULL REFERENCES order_history(id),
  due_at INTEGER NOT NULL,
  initial INTEGER NOT NULL DEFAULT 1
);
--> statement-breakpoint
CREATE TABLE push_event (
  history_id INTEGER PRIMARY KEY NOT NULL REFERENCES order_history(id) ON DELETE CASCADE
);
--> statement-breakpoint
CREATE TRIGGER push_history AFTER INSERT ON order_history BEGIN
  DELETE FROM push_schedule WHERE order_id = NEW.order_id;
  INSERT INTO push_schedule (order_id, history_id, due_at)
    SELECT NEW.order_id, NEW.id, NEW.at WHERE NEW.to_status = 'PENDING';
  INSERT INTO push_event (history_id)
    SELECT NEW.id WHERE NEW.action IN ('accept', 'deliver', 'reject', 'requeue')
      OR (NEW.action = 'cancel' AND NEW.actor_id != (SELECT user_id FROM orders WHERE id = NEW.order_id));
END;
--> statement-breakpoint
CREATE TRIGGER push_status AFTER UPDATE OF status ON orders WHEN NEW.status != 'PENDING' BEGIN
  DELETE FROM push_schedule WHERE order_id = NEW.id;
END;
--> statement-breakpoint
INSERT INTO push_schedule (order_id, history_id, due_at, initial)
  SELECT o.id, max(h.id), CAST(strftime('%s', 'now') AS INTEGER) * 1000, 0
  FROM orders o JOIN order_history h ON h.order_id = o.id WHERE o.status = 'PENDING' GROUP BY o.id;
