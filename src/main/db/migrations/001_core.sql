-- Bundled migration 1. Transaction and user_version belong to migrateDatabase.
-- UUID and Unicode/path validation are handled by CORE-05/06 before persistence.
CREATE TABLE projects (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL CHECK (length(trim(name)) > 0),
  description TEXT NOT NULL DEFAULT '',
  task_type TEXT NOT NULL CHECK (task_type IN ('classification', 'detection')),
  task_type_locked INTEGER NOT NULL DEFAULT 0 CHECK (task_type_locked IN (0, 1)),
  workspace_path TEXT NOT NULL CHECK (length(workspace_path) > 0),
  created_at TEXT NOT NULL CHECK (length(created_at) > 0),
  updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
) STRICT;

-- No defaults are seeded: only settings actually saved by the application exist.
-- Domain-specific Label Schema and Inference Profile use their later tables.
CREATE TABLE settings (
  key TEXT NOT NULL PRIMARY KEY CHECK (length(trim(key)) > 0),
  value TEXT NOT NULL
) STRICT;