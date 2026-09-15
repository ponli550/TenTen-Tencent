CREATE TABLE IF NOT EXISTS spaces (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  key TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  restricted INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL
);

-- Confluence semantics: page-level overrides space-level.
-- allowed=1 grants, allowed=0 explicitly denies (page-level restriction present).
-- Absence of a row = inherit from parent space.
CREATE TABLE IF NOT EXISTS permissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id),
  entity_type TEXT NOT NULL CHECK (entity_type IN ('space', 'page')),
  entity_id INTEGER NOT NULL,
  allowed INTEGER NOT NULL CHECK (allowed IN (0, 1)),
  UNIQUE (user_id, entity_type, entity_id)
);

CREATE TABLE IF NOT EXISTS pages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  space_id INTEGER NOT NULL REFERENCES spaces(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS page_embeddings (
  page_id INTEGER PRIMARY KEY REFERENCES pages(id),
  embedding TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Hash-chained, tamper-evident audit log.
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  seq INTEGER NOT NULL,
  prev_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  actor_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  query TEXT NOT NULL,
  candidates TEXT NOT NULL,
  allowed TEXT NOT NULL,
  denied TEXT NOT NULL,
  answer TEXT NOT NULL,
  chain_hash TEXT NOT NULL
);