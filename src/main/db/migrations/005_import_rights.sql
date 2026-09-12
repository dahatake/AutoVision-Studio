-- DAT-13 / FR-LIC-009: record explicit first-import acknowledgement per Project,
-- not a legal guarantee. No default, seed or backfill from existing imports.
-- migrateDatabase owns the transaction and user_version.
CREATE TABLE project_import_rights (
  project_id TEXT NOT NULL PRIMARY KEY REFERENCES projects(id) ON DELETE NO ACTION,
  -- Basic UTC ISO shape (Date.toISOString); the caller validates calendar dates.
  acknowledged_at TEXT NOT NULL CHECK (
    length(CAST(acknowledged_at AS BLOB)) = 24
    AND acknowledged_at GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]T[0-9][0-9]:[0-9][0-9]:[0-9][0-9].[0-9][0-9][0-9]Z'
  )
) STRICT, WITHOUT ROWID;

-- BEFORE INSERT prevents REPLACE's implicit deletion even with recursive
-- triggers OFF, and rejects IGNORE/upsert too. Repeated acknowledgement must
-- read the existing record instead. WITHOUT ROWID closes rowid replacement.
CREATE TRIGGER project_import_rights_guard_insert
BEFORE INSERT ON project_import_rights
WHEN EXISTS (SELECT 1 FROM project_import_rights WHERE project_id = NEW.project_id)
BEGIN
  SELECT RAISE(ABORT, 'project import rights already acknowledged');
END;

CREATE TRIGGER project_import_rights_guard_update
BEFORE UPDATE ON project_import_rights
WHEN NEW.project_id IS NOT OLD.project_id OR NEW.acknowledged_at IS NOT OLD.acknowledged_at
BEGIN
  SELECT RAISE(ABORT, 'project import rights acknowledgement is immutable');
END;

-- No public delete API here. Future Project deletion must explicitly delete
-- its owned acknowledgement first; existing import/job foreign keys still apply.