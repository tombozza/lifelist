-- D1 (SQLite) schema for life-kanban, migrated from Supabase/Postgres.
-- The app syncs its entire state as one JSON blob per sync_code, so this
-- mirrors Supabase's `kanban_sync` table verbatim as a key/value store.

CREATE TABLE IF NOT EXISTS kanban_sync (
  sync_code  TEXT PRIMARY KEY,
  data       TEXT NOT NULL,   -- JSON blob of {tasks, themes, archive, ...} (or {pending} for inbox rows)
  updated_at TEXT NOT NULL
);

-- Single-row app settings (id is always 1). Holds the optional site-password gate.
CREATE TABLE IF NOT EXISTS settings (
  id               INTEGER PRIMARY KEY CHECK (id = 1),
  password_enabled INTEGER NOT NULL DEFAULT 0,
  password_hash    TEXT
);
INSERT OR IGNORE INTO settings (id, password_enabled, password_hash) VALUES (1, 0, NULL);
