CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT,
  balance INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT,
  url TEXT,
  balance_after INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id)
);
CREATE INDEX idx_activity_user ON activity(user_id, created_at DESC);

CREATE TABLE contributions (
  user_id TEXT NOT NULL,
  url TEXT NOT NULL,
  earned INTEGER NOT NULL DEFAULT 0,
  hit_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, url),
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE TABLE stats (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 0
);
INSERT INTO stats (key, value) VALUES
  ('tokens_saved', 0),
  ('reads', 0),
  ('hits', 0),
  ('misses', 0);
