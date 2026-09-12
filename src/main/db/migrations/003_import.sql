-- Bundled migration 3. Transaction and user_version belong to migrateDatabase.
-- DAT-07 stores the bounded canonical scan result/source manifest plus indexed
-- source entries. Images remain files; no image/model BLOB belongs in SQLite.

-- Required by the composite foreign key below: a globally unique job must also
-- remain bound to the Project that created it.
CREATE UNIQUE INDEX jobs_project_id_id ON jobs(project_id, id);

CREATE TABLE data_imports (
  id TEXT NOT NULL PRIMARY KEY CHECK (length(id) = 36),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE NO ACTION,
  scan_job_id TEXT NOT NULL UNIQUE,
  task_type TEXT NOT NULL CHECK (task_type IN ('classification', 'detection')),
  mode TEXT NOT NULL CHECK (mode IN ('copy', 'reference')),
  created_at TEXT NOT NULL CHECK (length(created_at) > 0),
  updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
  scan_result_json TEXT NOT NULL CHECK (
    length(CAST(scan_result_json AS BLOB)) > 0
    AND length(CAST(scan_result_json AS BLOB)) <= 268435456
    AND json_valid(scan_result_json)
  ),
  scan_result_sha256 TEXT NOT NULL CHECK (
    length(scan_result_sha256) = 64
    AND scan_result_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  source_manifest_json TEXT NOT NULL CHECK (
    length(CAST(source_manifest_json AS BLOB)) > 0
    AND length(CAST(source_manifest_json AS BLOB)) <= 268435456
    AND json_valid(source_manifest_json)
  ),
  source_manifest_sha256 TEXT NOT NULL CHECK (
    length(source_manifest_sha256) = 64
    AND source_manifest_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  UNIQUE(id, mode),
  FOREIGN KEY(project_id, scan_job_id) REFERENCES jobs(project_id, id) ON DELETE NO ACTION
) STRICT;

CREATE INDEX data_imports_project_created_at ON data_imports(project_id, created_at, id);

-- This table is the bounded lookup projection of source_manifest_json. DAT-14
-- can resolve one image without parsing a potentially large scan result. Copy
-- rows are immutable Project-relative locations. Reference rows retain the
-- current Windows path/identity and may later be changed only by DAT-12's
-- checksum/CAS relink operation; source_manifest_json remains the transaction
-- boundary for that update.
CREATE TABLE import_sources (
  import_id TEXT NOT NULL,
  image_key TEXT NOT NULL CHECK (length(image_key) > 0),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  mode TEXT NOT NULL CHECK (mode IN ('copy', 'reference')),
  relative_path TEXT,
  relative_path_key TEXT,
  source_path TEXT,
  identity_dev TEXT,
  identity_ino TEXT,
  identity_birthtime_ns TEXT,
  byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 134217728),
  mtime_ns TEXT,
  sha256 TEXT NOT NULL CHECK (
    length(sha256) = 64
    AND sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  entry_sha256 TEXT NOT NULL CHECK (
    length(entry_sha256) = 64
    AND entry_sha256 NOT GLOB '*[^0-9a-f]*'
  ),
  PRIMARY KEY(import_id, image_key),
  UNIQUE(import_id, ordinal),
  UNIQUE(import_id, relative_path_key),
  FOREIGN KEY(import_id, mode) REFERENCES data_imports(id, mode) ON DELETE NO ACTION,
  CHECK (
    (mode = 'copy'
      AND relative_path IS NOT NULL AND length(relative_path) > 0
      AND relative_path_key IS NOT NULL AND length(relative_path_key) > 0
      AND source_path IS NULL
      AND identity_dev IS NULL AND identity_ino IS NULL AND identity_birthtime_ns IS NULL
      AND mtime_ns IS NULL)
    OR
    (mode = 'reference'
      AND relative_path IS NULL AND relative_path_key IS NULL
      AND source_path IS NOT NULL AND length(source_path) > 0
      AND identity_dev IS NOT NULL AND length(identity_dev) > 0
      AND identity_ino IS NOT NULL AND length(identity_ino) > 0
      AND identity_birthtime_ns IS NOT NULL AND length(identity_birthtime_ns) > 0
      AND mtime_ns IS NOT NULL AND length(mtime_ns) > 0)
  )
) STRICT;

-- Repository checks this too. The trigger protects direct SQL and closes the
-- validation/write gap inside the insertion statement.
CREATE TRIGGER data_imports_require_succeeded_scan
BEFORE INSERT ON data_imports
WHEN NOT EXISTS (
  SELECT 1 FROM jobs AS j
  JOIN projects AS p ON p.id = j.project_id
  WHERE j.id = NEW.scan_job_id AND j.project_id = NEW.project_id
    AND j.kind = 'scan-dataset' AND j.status = 'Succeeded'
    AND p.task_type = NEW.task_type
)
BEGIN
  SELECT RAISE(ABORT, 'data import requires a succeeded scan job');
END;

-- Succeeded is already terminal in JOB-02. Preserve lineage even if future
-- code attempts a direct SQL rewrite instead of using that state machine.
CREATE TRIGGER jobs_preserve_persisted_import
BEFORE UPDATE OF project_id, kind, status ON jobs
WHEN EXISTS (SELECT 1 FROM data_imports WHERE scan_job_id = OLD.id)
  AND (NEW.project_id <> OLD.project_id OR NEW.kind <> 'scan-dataset' OR NEW.status <> 'Succeeded')
BEGIN
  SELECT RAISE(ABORT, 'persisted import scan job is immutable');
END;

-- DAT-12 may replace only the Reference source manifest/hash/updated_at in a
-- short transaction. Import identity, scan evidence and mode never change.
CREATE TRIGGER data_imports_preserve_identity_and_scan
BEFORE UPDATE ON data_imports
WHEN NEW.id <> OLD.id
  OR NEW.project_id <> OLD.project_id
  OR NEW.scan_job_id <> OLD.scan_job_id
  OR NEW.task_type <> OLD.task_type
  OR NEW.mode <> OLD.mode
  OR NEW.created_at <> OLD.created_at
  OR NEW.scan_result_json <> OLD.scan_result_json
  OR NEW.scan_result_sha256 <> OLD.scan_result_sha256
BEGIN
  SELECT RAISE(ABORT, 'data import identity and scan result are immutable');
END;

CREATE TRIGGER data_imports_preserve_copy_manifest
BEFORE UPDATE OF updated_at, source_manifest_json, source_manifest_sha256 ON data_imports
WHEN OLD.mode = 'copy'
  AND (NEW.updated_at <> OLD.updated_at
    OR NEW.source_manifest_json <> OLD.source_manifest_json
    OR NEW.source_manifest_sha256 <> OLD.source_manifest_sha256)
BEGIN
  SELECT RAISE(ABORT, 'copy source manifest is immutable');
END;

CREATE TRIGGER import_sources_preserve_identity_fields
BEFORE UPDATE ON import_sources
WHEN NEW.import_id <> OLD.import_id
  OR NEW.image_key <> OLD.image_key
  OR NEW.ordinal <> OLD.ordinal
  OR NEW.mode <> OLD.mode
  OR NEW.byte_size <> OLD.byte_size
  OR NEW.sha256 <> OLD.sha256
BEGIN
  SELECT RAISE(ABORT, 'import source identity and content hash are immutable');
END;

CREATE TRIGGER import_sources_preserve_copy_binding
BEFORE UPDATE ON import_sources
WHEN OLD.mode = 'copy'
  AND (NEW.relative_path <> OLD.relative_path
    OR NEW.relative_path_key <> OLD.relative_path_key
    OR NEW.entry_sha256 <> OLD.entry_sha256)
BEGIN
  SELECT RAISE(ABORT, 'copy source binding is immutable');
END;
