CREATE TABLE user (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  email_verified INTEGER NOT NULL DEFAULT 0,
  image TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  username TEXT NOT NULL UNIQUE,
  display_username TEXT,
  role TEXT NOT NULL DEFAULT 'employee' CHECK (role IN ('employee', 'staff', 'admin')),
  banned INTEGER NOT NULL DEFAULT 0,
  ban_reason TEXT,
  ban_expires INTEGER,
  language TEXT NOT NULL DEFAULT 'bn' CHECK (language IN ('bn', 'en')),
  floor TEXT NOT NULL DEFAULT '',
  desk TEXT NOT NULL DEFAULT '',
  must_change_password INTEGER NOT NULL DEFAULT 0
);
--> statement-breakpoint
CREATE TABLE session (
  id TEXT PRIMARY KEY NOT NULL,
  expires_at INTEGER NOT NULL,
  token TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  impersonated_by TEXT
);
--> statement-breakpoint
CREATE INDEX session_user_id_idx ON session(user_id);
--> statement-breakpoint
CREATE TABLE account (
  id TEXT PRIMARY KEY NOT NULL,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  scope TEXT,
  password TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(provider_id, account_id)
);
--> statement-breakpoint
CREATE INDEX account_user_id_idx ON account(user_id);
--> statement-breakpoint
CREATE TABLE verification (
  id TEXT PRIMARY KEY NOT NULL,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
--> statement-breakpoint
CREATE INDEX verification_identifier_idx ON verification(identifier);
--> statement-breakpoint
CREATE TABLE setup (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  user_id TEXT NOT NULL REFERENCES user(id)
);
--> statement-breakpoint
CREATE TABLE rate_limit (
  key TEXT PRIMARY KEY NOT NULL,
  window INTEGER NOT NULL,
  count INTEGER NOT NULL
);
