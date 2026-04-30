PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS schema_version (version INTEGER PRIMARY KEY);
INSERT OR IGNORE INTO schema_version(version) VALUES (1);

CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  cwd TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id),
  jsonl_path TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  last_msg_at INTEGER,
  msg_count INTEGER DEFAULT 0,
  tokens_in INTEGER DEFAULT 0,
  tokens_out INTEGER DEFAULT 0,
  model TEXT,
  ended_at INTEGER,
  status TEXT DEFAULT 'idle',
  tail_offset INTEGER DEFAULT 0,
  error_count INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_sessions_project  ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_last_msg ON sessions(last_msg_at DESC);

CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  session_id UNINDEXED, role, content, ts UNINDEXED, tokenize='porter unicode61'
);

CREATE TABLE IF NOT EXISTS live_sessions (
  pid INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  cwd TEXT NOT NULL,
  status TEXT,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS summaries (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id),
  title TEXT, summary TEXT, recommendation TEXT,
  generated_at INTEGER NOT NULL,
  generator TEXT
);
CREATE VIRTUAL TABLE IF NOT EXISTS summaries_fts USING fts5(
  session_id UNINDEXED, title, summary, recommendation
);

CREATE TABLE IF NOT EXISTS watchers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  target_id TEXT,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  trigger_kind TEXT NOT NULL,
  trigger_value TEXT NOT NULL,
  enabled INTEGER DEFAULT 1,
  notify_webhook TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS watcher_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  watcher_id INTEGER NOT NULL REFERENCES watchers(id),
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  status TEXT,
  output TEXT,
  alert_msg TEXT
);
CREATE INDEX IF NOT EXISTS idx_watcher_runs_watcher ON watcher_runs(watcher_id, started_at DESC);

CREATE TABLE IF NOT EXISTS feed (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  project_id TEXT,
  session_id TEXT,
  payload TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_feed_ts ON feed(ts DESC);

CREATE TABLE IF NOT EXISTS pet_health (
  scope TEXT NOT NULL,
  target_id TEXT NOT NULL,
  hp INTEGER,
  activity_pct INTEGER,
  error_pct INTEGER,
  watcher_pct INTEGER,
  tokens_pct INTEGER,
  face TEXT,
  ai_advice TEXT,
  computed_at INTEGER NOT NULL,
  PRIMARY KEY (scope, target_id)
);

CREATE TABLE IF NOT EXISTS obsidian_notes (
  path TEXT PRIMARY KEY,
  project_id TEXT,
  session_id TEXT,
  mtime INTEGER NOT NULL,
  excerpt TEXT
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO settings(key,value) VALUES
  ('health_weights', '{"activity":0.4,"errors":0.3,"watcher":0.2,"tokens":0.1}'),
  ('concurrency_caps', '{"watchers":3,"summaries":2}'),
  ('quota_threshold', '5000000'),
  ('project_hp_strategy', 'max');

-- Per-project user-defined tasks (open URL, run command, tail log)
CREATE TABLE IF NOT EXISTS project_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL REFERENCES projects(id),
  name TEXT NOT NULL,
  kind TEXT NOT NULL,           -- 'open_url' | 'run_command' | 'tail_log'
  config TEXT NOT NULL,         -- JSON
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_project_tasks_proj ON project_tasks(project_id);
