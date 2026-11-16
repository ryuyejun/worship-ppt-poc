CREATE TABLE IF NOT EXISTS auth_users (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 email TEXT NOT NULL UNIQUE COLLATE NOCASE,
 password_hash TEXT NOT NULL,
 password_salt TEXT NOT NULL,
 created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
 id TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
 refresh_hash TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 last_used_at TEXT NOT NULL,
 revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_user_id ON auth_sessions(user_id);
