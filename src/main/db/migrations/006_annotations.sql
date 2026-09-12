-- ANN-01. Pure SQL; migrateDatabase owns transaction/user_version. No seed data.
-- Main (ANN-02/03/05/15/19) owns UUID generation, Unicode normalization (including
-- Unicode whitespace), canonical JSON/duplicate-key rejection, actual SHA-256,
-- optimistic CAS using edit_version, user-intent authentication, filesystem
-- containment/atomic manifest publication, split policy and Queue registration.
-- SQL cannot prove human confirmation or file bytes. AST must add real Suggestion
-- FKs and pending-decision gates before enabling model provenance; rejected here.
-- JSON limits are storage ceilings, not UI defaults: annotation/provenance 1 MiB,
-- examples 64 KiB, schema 4 MiB, manifest 256 MiB. Timestamps are caller UTC text.

CREATE TABLE label_schemas (
  id TEXT PRIMARY KEY CHECK (length(id) = 36 AND id GLOB '????????-????-????-????-????????????'
    AND replace(id, '-', '') NOT GLOB '*[^0-9a-f]*'),
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE NO ACTION,
  instructions TEXT NOT NULL DEFAULT '' CHECK (length(CAST(instructions AS BLOB)) <= 65536),
  locked_at TEXT CHECK (locked_at IS NULL OR length(locked_at) > 0),
  edit_version INTEGER NOT NULL DEFAULT 0 CHECK (edit_version BETWEEN 0 AND 9007199254740991),
  created_at TEXT NOT NULL CHECK (length(created_at) > 0),
  updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
) STRICT, WITHOUT ROWID;

CREATE TABLE label_classes (
  id TEXT PRIMARY KEY CHECK (length(id) = 36 AND id GLOB '????????-????-????-????-????????????'
    AND replace(id, '-', '') NOT GLOB '*[^0-9a-f]*'),
  schema_id TEXT NOT NULL REFERENCES label_schemas(id) ON DELETE NO ACTION,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 256),
  normalized_name TEXT NOT NULL CHECK (length(trim(normalized_name)) BETWEEN 1 AND 256),
  model_alias TEXT CHECK (model_alias IS NULL OR length(trim(model_alias)) BETWEEN 1 AND 256),
  color TEXT NOT NULL CHECK (length(color) = 7 AND substr(color, 1, 1) = '#'
    AND substr(color, 2) NOT GLOB '*[^0-9a-fA-F]*'),
  description TEXT NOT NULL DEFAULT '' CHECK (length(CAST(description AS BLOB)) <= 65536),
  examples_json TEXT NOT NULL DEFAULT '[]' CHECK (length(CAST(examples_json AS BLOB)) <= 65536
    AND json_valid(examples_json) AND json_type(examples_json) = 'array'),
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  created_at TEXT NOT NULL CHECK (length(created_at) > 0),
  updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
  UNIQUE(schema_id, normalized_name)
) STRICT, WITHOUT ROWID;

CREATE TABLE annotation_workspaces (
  id TEXT PRIMARY KEY CHECK (length(id) = 36 AND id GLOB '????????-????-????-????-????????????'
    AND replace(id, '-', '') NOT GLOB '*[^0-9a-f]*'),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE NO ACTION,
  schema_id TEXT NOT NULL REFERENCES label_schemas(id) ON DELETE NO ACTION,
  task_type TEXT NOT NULL CHECK (task_type IN ('classification', 'detection')),
  mode TEXT NOT NULL CHECK (mode IN ('copy', 'reference')),
  state TEXT NOT NULL DEFAULT 'editing' CHECK (state IN ('editing', 'frozen')),
  edit_version INTEGER NOT NULL DEFAULT 0 CHECK (edit_version BETWEEN 0 AND 9007199254740991),
  created_at TEXT NOT NULL CHECK (length(created_at) > 0),
  updated_at TEXT NOT NULL CHECK (length(updated_at) > 0)
) STRICT, WITHOUT ROWID;
CREATE INDEX annotation_workspaces_project ON annotation_workspaces(project_id, updated_at, id);

CREATE TABLE annotation_items (
  id TEXT PRIMARY KEY CHECK (length(id) = 36 AND id GLOB '????????-????-????-????-????????????'
    AND replace(id, '-', '') NOT GLOB '*[^0-9a-f]*'),
  workspace_id TEXT NOT NULL REFERENCES annotation_workspaces(id) ON DELETE NO ACTION,
  import_id TEXT NOT NULL,
  image_key TEXT NOT NULL,
  image_sha256 TEXT NOT NULL CHECK (length(image_sha256) = 64 AND image_sha256 NOT GLOB '*[^0-9a-f]*'),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 2147483647),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 2147483647),
  annotation_json TEXT NOT NULL CHECK (length(CAST(annotation_json AS BLOB)) <= 1048576
    AND json_valid(annotation_json) AND json_type(annotation_json) = 'object'
    AND COALESCE((json_extract(annotation_json, '$.kind') = 'classification'
      AND json_type(annotation_json, '$.classId') IN ('text', 'null'))
      OR (json_extract(annotation_json, '$.kind') = 'detection'
      AND json_type(annotation_json, '$.rectangles') = 'array'), 0)),
  annotation_sha256 TEXT NOT NULL CHECK (length(annotation_sha256) = 64 AND annotation_sha256 NOT GLOB '*[^0-9a-f]*'),
  state TEXT NOT NULL DEFAULT 'unstarted' CHECK (state IN ('unstarted', 'suggested', 'editing', 'confirmed', 'excluded')),
  negative_confirmed INTEGER NOT NULL DEFAULT 0 CHECK (negative_confirmed IN (0, 1)),
  exclusion_reason TEXT CHECK (exclusion_reason IS NULL OR length(CAST(exclusion_reason AS BLOB)) <= 4096),
  edit_version INTEGER NOT NULL DEFAULT 0 CHECK (edit_version BETWEEN 0 AND 9007199254740991),
  confirmed_at TEXT CHECK (confirmed_at IS NULL OR length(confirmed_at) > 0),
  updated_at TEXT NOT NULL CHECK (length(updated_at) > 0),
  UNIQUE(workspace_id, import_id, image_key),
  FOREIGN KEY(import_id, image_key) REFERENCES import_sources(import_id, image_key) ON DELETE NO ACTION,
  CHECK ((state = 'confirmed') = (confirmed_at IS NOT NULL)),
  CHECK (state = 'excluded' OR exclusion_reason IS NULL),
  CHECK (negative_confirmed = 0 OR (state = 'confirmed'
    AND json_extract(annotation_json, '$.kind') = 'detection'
    AND json_array_length(annotation_json, '$.rectangles') = 0))
) STRICT, WITHOUT ROWID;
CREATE INDEX annotation_items_state ON annotation_items(workspace_id, state, updated_at, id);
CREATE INDEX annotation_items_source ON annotation_items(import_id, image_key);

-- target_key = 'classification', or the rectangle id. Negative/excluded items
-- may have no targets. For imported targets, source_annotation_key is the raw
-- import label/annotation identifier; Main checks it against scan_result_json.
CREATE TABLE annotation_provenance (
  item_id TEXT NOT NULL REFERENCES annotation_items(id) ON DELETE NO ACTION,
  target_key TEXT NOT NULL CHECK (length(target_key) BETWEEN 1 AND 256),
  kind TEXT NOT NULL CHECK (kind IN ('manual', 'import-unmodified', 'import-edited', 'model-accepted', 'model-edited')),
  source_import_id TEXT,
  source_image_key TEXT,
  source_annotation_key TEXT,
  source_suggestion_id TEXT,
  original_json TEXT NOT NULL DEFAULT '{}' CHECK (length(CAST(original_json AS BLOB)) <= 1048576
    AND json_valid(original_json) AND json_type(original_json) = 'object'),
  changes_json TEXT NOT NULL DEFAULT '{}' CHECK (length(CAST(changes_json AS BLOB)) <= 1048576
    AND json_valid(changes_json) AND json_type(changes_json) = 'object'),
  PRIMARY KEY(item_id, target_key),
  FOREIGN KEY(source_import_id, source_image_key) REFERENCES import_sources(import_id, image_key) ON DELETE NO ACTION,
  CHECK ((source_import_id IS NULL) = (source_image_key IS NULL)),
  CHECK ((kind = 'manual' AND source_import_id IS NULL AND source_annotation_key IS NULL AND source_suggestion_id IS NULL)
    OR (kind IN ('import-unmodified', 'import-edited') AND source_import_id IS NOT NULL
      AND source_annotation_key IS NOT NULL AND length(source_annotation_key) > 0 AND source_suggestion_id IS NULL)),
  -- Deliberately fail closed until AST supplies an actual FK, not a fake model ID.
  CHECK (kind NOT IN ('model-accepted', 'model-edited'))
) STRICT, WITHOUT ROWID;
CREATE INDEX annotation_provenance_source ON annotation_provenance(source_import_id, source_image_key);

CREATE TABLE dataset_revisions (
  id TEXT PRIMARY KEY CHECK (length(id) = 36 AND id GLOB '????????-????-????-????-????????????'
    AND replace(id, '-', '') NOT GLOB '*[^0-9a-f]*'),
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE NO ACTION,
  workspace_id TEXT NOT NULL UNIQUE REFERENCES annotation_workspaces(id) ON DELETE NO ACTION,
  revision_no INTEGER NOT NULL CHECK (revision_no BETWEEN 1 AND 9007199254740991),
  mode TEXT NOT NULL CHECK (mode IN ('copy', 'reference')),
  manifest_json TEXT NOT NULL CHECK (length(CAST(manifest_json AS BLOB)) <= 268435456
    AND json_valid(manifest_json) AND json_type(manifest_json) = 'object'),
  manifest_sha256 TEXT NOT NULL CHECK (length(manifest_sha256) = 64 AND manifest_sha256 NOT GLOB '*[^0-9a-f]*'),
  manifest_relative_path TEXT NOT NULL CHECK (manifest_relative_path = 'datasets/' || id || '/manifest.json'),
  schema_snapshot_json TEXT NOT NULL CHECK (length(CAST(schema_snapshot_json AS BLOB)) <= 4194304
    AND json_valid(schema_snapshot_json) AND json_type(schema_snapshot_json) = 'object'),
  split_seed INTEGER NOT NULL CHECK (split_seed BETWEEN 0 AND 9007199254740991),
  created_by TEXT NOT NULL CHECK (length(trim(created_by)) BETWEEN 1 AND 256),
  confirmed_at TEXT NOT NULL CHECK (length(confirmed_at) > 0),
  last_verified_at TEXT CHECK (last_verified_at IS NULL OR (mode = 'reference' AND length(last_verified_at) > 0)),
  UNIQUE(project_id, revision_no)
) STRICT, WITHOUT ROWID;

CREATE TABLE dataset_items (
  id TEXT PRIMARY KEY CHECK (length(id) = 36 AND id GLOB '????????-????-????-????-????????????'
    AND replace(id, '-', '') NOT GLOB '*[^0-9a-f]*'),
  revision_id TEXT NOT NULL REFERENCES dataset_revisions(id) ON DELETE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  source_item_id TEXT NOT NULL REFERENCES annotation_items(id) ON DELETE NO ACTION,
  import_id TEXT NOT NULL,
  image_key TEXT NOT NULL,
  image_sha256 TEXT NOT NULL CHECK (length(image_sha256) = 64 AND image_sha256 NOT GLOB '*[^0-9a-f]*'),
  width INTEGER NOT NULL CHECK (width BETWEEN 1 AND 2147483647),
  height INTEGER NOT NULL CHECK (height BETWEEN 1 AND 2147483647),
  source_snapshot_json TEXT NOT NULL CHECK (length(CAST(source_snapshot_json AS BLOB)) <= 1048576
    AND json_valid(source_snapshot_json) AND json_type(source_snapshot_json) = 'object'),
  annotation_json TEXT NOT NULL CHECK (length(CAST(annotation_json AS BLOB)) <= 1048576
    AND json_valid(annotation_json) AND json_type(annotation_json) = 'object'),
  annotation_sha256 TEXT NOT NULL CHECK (length(annotation_sha256) = 64 AND annotation_sha256 NOT GLOB '*[^0-9a-f]*'),
  provenance_json TEXT NOT NULL CHECK (length(CAST(provenance_json AS BLOB)) <= 1048576
    AND json_valid(provenance_json) AND json_type(provenance_json) = 'object'),
  disposition TEXT NOT NULL CHECK (disposition IN ('labeled', 'negative', 'excluded')),
  exclusion_reason TEXT,
  split TEXT CHECK (split IN ('train', 'validation', 'test')),
  UNIQUE(revision_id, source_item_id),
  UNIQUE(revision_id, import_id, image_key),
  FOREIGN KEY(import_id, image_key) REFERENCES import_sources(import_id, image_key) ON DELETE NO ACTION,
  CHECK ((disposition = 'excluded' AND split IS NULL)
    OR (disposition <> 'excluded' AND split IS NOT NULL AND exclusion_reason IS NULL))
) STRICT, WITHOUT ROWID;
CREATE INDEX dataset_items_source ON dataset_items(source_item_id);

CREATE TABLE workspace_revision_sources (
  workspace_id TEXT NOT NULL REFERENCES annotation_workspaces(id) ON DELETE NO ACTION,
  source_revision_id TEXT NOT NULL REFERENCES dataset_revisions(id) ON DELETE NO ACTION,
  PRIMARY KEY(workspace_id, source_revision_id)
) STRICT, WITHOUT ROWID;

-- Snapshot projections are the exact SQL serialization contract for ANN-19.
-- Copy their TEXT unchanged; they are not cryptographic canonicalization APIs.
CREATE VIEW annotation_schema_snapshots AS
SELECT s.id AS schema_id, json_object('id', s.id, 'projectId', s.project_id,
  'instructions', s.instructions, 'lockedAt', s.locked_at, 'editVersion', s.edit_version,
  'classes', json((SELECT json_group_array(json_object('id', c.id, 'displayName', c.display_name,
    'normalizedName', c.normalized_name, 'modelAlias', c.model_alias, 'color', c.color,
    'description', c.description, 'examples', json(c.examples_json), 'ordinal', c.ordinal))
    FROM (SELECT * FROM label_classes WHERE schema_id = s.id ORDER BY ordinal, id) c))) AS snapshot_json
FROM label_schemas s;

CREATE VIEW annotation_provenance_snapshots AS
SELECT a.id AS item_id, (SELECT json_group_object(p.target_key, json_object('kind', p.kind,
  'sourceImportId', p.source_import_id, 'sourceImageKey', p.source_image_key,
  'sourceAnnotationKey', p.source_annotation_key, 'sourceSuggestionId', p.source_suggestion_id,
  'original', json(p.original_json), 'changes', json(p.changes_json)))
  FROM (SELECT * FROM annotation_provenance WHERE item_id = a.id ORDER BY target_key) p) AS snapshot_json
FROM annotation_items a;

CREATE VIEW annotation_source_snapshots AS
SELECT import_id, image_key, json_object('mode', mode, 'relativePath', relative_path,
  'sourcePath', source_path, 'identityDev', identity_dev, 'identityIno', identity_ino,
  'identityBirthtimeNs', identity_birthtime_ns, 'byteSize', byte_size, 'mtimeNs', mtime_ns,
  'sha256', sha256, 'entrySha256', entry_sha256) AS snapshot_json FROM import_sources;

CREATE TRIGGER label_schemas_insert BEFORE INSERT ON label_schemas BEGIN
  SELECT RAISE(ABORT, 'schema replacement or prelocked insertion forbidden')
    WHERE NEW.locked_at IS NOT NULL OR EXISTS (
      SELECT 1 FROM label_schemas WHERE id = NEW.id OR project_id = NEW.project_id);
END;
CREATE TRIGGER label_schemas_update BEFORE UPDATE ON label_schemas BEGIN
  SELECT RAISE(ABORT, 'schema identity/lock/version immutable') WHERE OLD.locked_at IS NOT NULL
    OR NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.created_at IS NOT OLD.created_at
    OR NEW.edit_version IS NOT OLD.edit_version + 1;
END;
CREATE TRIGGER label_schemas_delete BEFORE DELETE ON label_schemas
WHEN OLD.locked_at IS NOT NULL
  OR EXISTS (SELECT 1 FROM annotation_workspaces WHERE schema_id = OLD.id) BEGIN
  SELECT RAISE(ABORT, 'locked or referenced schema immutable');
END;

CREATE TRIGGER label_classes_insert BEFORE INSERT ON label_classes BEGIN
  SELECT RAISE(ABORT, 'class schema locked or replacement forbidden') WHERE NOT EXISTS (
    SELECT 1 FROM label_schemas WHERE id = NEW.schema_id AND locked_at IS NULL)
    OR EXISTS (SELECT 1 FROM label_classes WHERE id = NEW.id
      OR (schema_id = NEW.schema_id AND normalized_name = NEW.normalized_name));
END;
CREATE TRIGGER label_classes_update BEFORE UPDATE ON label_classes BEGIN
  SELECT RAISE(ABORT, 'class identity/lock immutable') WHERE NEW.id IS NOT OLD.id
    OR NEW.schema_id IS NOT OLD.schema_id OR NEW.created_at IS NOT OLD.created_at
    OR NOT EXISTS (SELECT 1 FROM label_schemas WHERE id = OLD.schema_id AND locked_at IS NULL)
    OR EXISTS (SELECT 1 FROM label_classes WHERE schema_id = NEW.schema_id
      AND normalized_name = NEW.normalized_name AND id <> OLD.id);
END;
CREATE TRIGGER label_classes_delete BEFORE DELETE ON label_classes BEGIN
  SELECT RAISE(ABORT, 'locked or used class cannot be deleted') WHERE
    EXISTS (SELECT 1 FROM label_schemas WHERE id = OLD.schema_id AND locked_at IS NOT NULL)
    OR EXISTS (SELECT 1 FROM annotation_items a WHERE json_extract(a.annotation_json, '$.classId') = OLD.id
      OR EXISTS (SELECT 1 FROM json_each(a.annotation_json, '$.rectangles') r
        WHERE json_extract(r.value, '$.classId') = OLD.id));
END;

CREATE TRIGGER annotation_workspaces_insert BEFORE INSERT ON annotation_workspaces BEGIN
  SELECT RAISE(ABORT, 'workspace requires matching Project/task/schema and editing state')
    WHERE NEW.state <> 'editing' OR EXISTS (SELECT 1 FROM annotation_workspaces WHERE id = NEW.id)
    OR NOT EXISTS (SELECT 1 FROM projects p JOIN label_schemas s ON s.project_id = p.id
      WHERE p.id = NEW.project_id AND p.task_type = NEW.task_type AND s.id = NEW.schema_id);
END;
CREATE TRIGGER annotation_workspaces_update BEFORE UPDATE ON annotation_workspaces BEGIN
  SELECT RAISE(ABORT, 'workspace immutable identity/frozen/version') WHERE OLD.state = 'frozen'
    OR NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id OR NEW.schema_id IS NOT OLD.schema_id
    OR NEW.task_type IS NOT OLD.task_type OR NEW.mode IS NOT OLD.mode OR NEW.created_at IS NOT OLD.created_at
    OR NEW.edit_version IS NOT OLD.edit_version + 1
    OR (NEW.state = 'frozen' AND NOT EXISTS (SELECT 1 FROM dataset_revisions WHERE workspace_id = OLD.id));
END;
CREATE TRIGGER annotation_workspaces_delete BEFORE DELETE ON annotation_workspaces
WHEN OLD.state = 'frozen'
  OR EXISTS (SELECT 1 FROM annotation_items WHERE workspace_id = OLD.id)
  OR EXISTS (SELECT 1 FROM workspace_revision_sources WHERE workspace_id = OLD.id) BEGIN
  SELECT RAISE(ABORT, 'frozen or referenced workspace immutable');
END;

CREATE TRIGGER annotation_items_insert BEFORE INSERT ON annotation_items BEGIN
  SELECT RAISE(ABORT, 'item replacement or insert-confirmation forbidden') WHERE NEW.state = 'confirmed'
    OR EXISTS (SELECT 1 FROM annotation_items WHERE id = NEW.id
      OR (workspace_id = NEW.workspace_id AND import_id = NEW.import_id AND image_key = NEW.image_key));
  SELECT RAISE(ABORT, 'item source/Project/task/schema/mode/hash mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM annotation_workspaces w JOIN data_imports d ON d.project_id = w.project_id
    JOIN import_sources s ON s.import_id = d.id WHERE w.id = NEW.workspace_id AND w.state = 'editing'
    AND d.task_type = w.task_type AND d.mode = w.mode AND s.import_id = NEW.import_id
    AND s.image_key = NEW.image_key AND s.sha256 = NEW.image_sha256
    AND json_extract(NEW.annotation_json, '$.kind') = w.task_type);
END;
CREATE TRIGGER annotation_items_update BEFORE UPDATE ON annotation_items BEGIN
  SELECT RAISE(ABORT, 'item identity/frozen/version immutable') WHERE NEW.id IS NOT OLD.id
    OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.import_id IS NOT OLD.import_id
    OR NEW.image_key IS NOT OLD.image_key OR NEW.image_sha256 IS NOT OLD.image_sha256
    OR NEW.width IS NOT OLD.width OR NEW.height IS NOT OLD.height
    OR NEW.edit_version IS NOT OLD.edit_version + 1
    OR NOT EXISTS (SELECT 1 FROM annotation_workspaces WHERE id = OLD.workspace_id AND state = 'editing'
      AND task_type = json_extract(NEW.annotation_json, '$.kind'));
  SELECT RAISE(ABORT, 'content edits must clear confirmation') WHERE OLD.state = 'confirmed' AND NEW.state = 'confirmed'
    AND (NEW.annotation_json IS NOT OLD.annotation_json OR NEW.annotation_sha256 IS NOT OLD.annotation_sha256
      OR NEW.negative_confirmed IS NOT OLD.negative_confirmed OR NEW.confirmed_at IS NOT OLD.confirmed_at);
END;
CREATE TRIGGER annotation_items_delete BEFORE DELETE ON annotation_items BEGIN
  SELECT RAISE(ABORT, 'frozen item immutable') WHERE EXISTS (
    SELECT 1 FROM annotation_workspaces WHERE id = OLD.workspace_id AND state = 'frozen');
  SELECT RAISE(ABORT, 'referenced annotation item cannot be deleted') WHERE
    EXISTS (SELECT 1 FROM annotation_provenance WHERE item_id = OLD.id)
    OR EXISTS (SELECT 1 FROM dataset_items WHERE source_item_id = OLD.id);
END;

CREATE TRIGGER annotation_items_confirm AFTER UPDATE ON annotation_items WHEN NEW.state = 'confirmed' BEGIN
  SELECT RAISE(ABORT, 'import provenance source binding mismatch') WHERE EXISTS (
    SELECT 1 FROM annotation_provenance p WHERE p.item_id = NEW.id
      AND p.kind IN ('import-unmodified', 'import-edited')
      AND (p.source_import_id IS NOT NEW.import_id OR p.source_image_key IS NOT NEW.image_key));
  SELECT RAISE(ABORT, 'classification requires one Schema class and provenance')
    WHERE json_extract(NEW.annotation_json, '$.kind') = 'classification' AND (NEW.negative_confirmed <> 0
      OR NOT EXISTS (SELECT 1 FROM label_classes c JOIN annotation_workspaces w ON w.schema_id = c.schema_id
        WHERE w.id = NEW.workspace_id AND c.id = json_extract(NEW.annotation_json, '$.classId'))
      OR NOT EXISTS (SELECT 1 FROM annotation_provenance WHERE item_id = NEW.id AND target_key = 'classification'));
  SELECT RAISE(ABORT, 'empty detection requires explicit negative confirmation')
    WHERE json_extract(NEW.annotation_json, '$.kind') = 'detection'
    AND (json_array_length(NEW.annotation_json, '$.rectangles') = 0) <> NEW.negative_confirmed;
  SELECT RAISE(ABORT, 'invalid rectangle/class/provenance') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.annotation_json, '$.rectangles') r WHERE COALESCE(
      r.type = 'object' AND json_type(r.value, '$.id') = 'text' AND length(json_extract(r.value, '$.id')) BETWEEN 1 AND 256
      AND json_type(r.value, '$.classId') = 'text'
      AND json_type(r.value, '$.x') IN ('integer', 'real') AND json_type(r.value, '$.y') IN ('integer', 'real')
      AND json_type(r.value, '$.width') IN ('integer', 'real') AND json_type(r.value, '$.height') IN ('integer', 'real')
      AND json_extract(r.value, '$.x') BETWEEN 0 AND NEW.width
      AND json_extract(r.value, '$.y') BETWEEN 0 AND NEW.height
      AND json_extract(r.value, '$.width') > 0 AND json_extract(r.value, '$.height') > 0
      AND json_extract(r.value, '$.width') <= NEW.width - json_extract(r.value, '$.x')
      AND json_extract(r.value, '$.height') <= NEW.height - json_extract(r.value, '$.y')
      AND EXISTS (SELECT 1 FROM label_classes c JOIN annotation_workspaces w ON w.schema_id = c.schema_id
        WHERE w.id = NEW.workspace_id AND c.id = json_extract(r.value, '$.classId'))
      AND EXISTS (SELECT 1 FROM annotation_provenance WHERE item_id = NEW.id AND target_key = json_extract(r.value, '$.id')), 0) = 0);
  SELECT RAISE(ABORT, 'duplicate rectangle identity') WHERE EXISTS (
    SELECT 1 FROM json_each(NEW.annotation_json, '$.rectangles') r
    GROUP BY json_extract(r.value, '$.id') HAVING count(*) > 1);
  SELECT RAISE(ABORT, 'orphan provenance target') WHERE EXISTS (
    SELECT 1 FROM annotation_provenance p WHERE p.item_id = NEW.id AND NOT (
      (json_extract(NEW.annotation_json, '$.kind') = 'classification' AND p.target_key = 'classification')
      OR EXISTS (SELECT 1 FROM json_each(NEW.annotation_json, '$.rectangles') r
        WHERE json_extract(r.value, '$.id') = p.target_key)));
END;

CREATE TRIGGER annotation_provenance_insert BEFORE INSERT ON annotation_provenance BEGIN
  SELECT RAISE(ABORT, 'provenance requires editable unconfirmed item and source binding') WHERE
    EXISTS (SELECT 1 FROM annotation_provenance WHERE item_id = NEW.item_id AND target_key = NEW.target_key)
    OR NOT EXISTS (SELECT 1 FROM annotation_items a JOIN annotation_workspaces w ON w.id = a.workspace_id
      WHERE a.id = NEW.item_id AND a.state <> 'confirmed' AND w.state = 'editing'
      AND (NEW.source_import_id IS NULL OR (NEW.source_import_id = a.import_id AND NEW.source_image_key = a.image_key)));
END;
CREATE TRIGGER annotation_provenance_update BEFORE UPDATE ON annotation_provenance BEGIN
  SELECT RAISE(ABORT, 'provenance identity/frozen/confirmation/source binding') WHERE
    NEW.item_id IS NOT OLD.item_id OR NEW.target_key IS NOT OLD.target_key
    OR NOT EXISTS (SELECT 1 FROM annotation_items a JOIN annotation_workspaces w ON w.id = a.workspace_id
      WHERE a.id = OLD.item_id AND a.state <> 'confirmed' AND w.state = 'editing'
      AND (NEW.source_import_id IS NULL OR (NEW.source_import_id = a.import_id AND NEW.source_image_key = a.image_key)));
END;
CREATE TRIGGER annotation_provenance_delete BEFORE DELETE ON annotation_provenance BEGIN
  SELECT RAISE(ABORT, 'provenance frozen/confirmed') WHERE EXISTS (
    SELECT 1 FROM annotation_items a JOIN annotation_workspaces w ON w.id = a.workspace_id
    WHERE a.id = OLD.item_id AND (a.state = 'confirmed' OR w.state = 'frozen'));
END;

-- Children first, then header, in ONE transaction. No persisted staging queue.
-- Header validates a complete one-to-one workspace snapshot and freezes it.
CREATE TRIGGER dataset_items_insert BEFORE INSERT ON dataset_items BEGIN
  SELECT RAISE(ABORT, 'dataset item immutable or header already published') WHERE
    EXISTS (SELECT 1 FROM dataset_revisions WHERE id = NEW.revision_id)
    OR EXISTS (SELECT 1 FROM dataset_items WHERE id = NEW.id OR (revision_id = NEW.revision_id
      AND (source_item_id = NEW.source_item_id OR (import_id = NEW.import_id AND image_key = NEW.image_key))));
END;
CREATE TRIGGER dataset_items_update BEFORE UPDATE ON dataset_items BEGIN
  SELECT RAISE(ABORT, 'dataset item immutable');
END;
CREATE TRIGGER dataset_items_delete BEFORE DELETE ON dataset_items BEGIN
  SELECT RAISE(ABORT, 'dataset item immutable');
END;
CREATE TRIGGER dataset_revisions_insert BEFORE INSERT ON dataset_revisions BEGIN
  SELECT RAISE(ABORT, 'dataset revision immutable/replacement forbidden') WHERE EXISTS (
    SELECT 1 FROM dataset_revisions WHERE id = NEW.id OR workspace_id = NEW.workspace_id
      OR (project_id = NEW.project_id AND revision_no = NEW.revision_no));
  SELECT RAISE(ABORT, 'revision workspace/schema mismatch') WHERE NOT EXISTS (
    SELECT 1 FROM annotation_workspaces w JOIN annotation_schema_snapshots s ON s.schema_id = w.schema_id
    WHERE w.id = NEW.workspace_id AND w.project_id = NEW.project_id AND w.mode = NEW.mode
      AND w.state = 'editing' AND s.snapshot_json = NEW.schema_snapshot_json);
  SELECT RAISE(ABORT, 'revision requires all confirmed/excluded and at least one included') WHERE
    NOT EXISTS (SELECT 1 FROM annotation_items WHERE workspace_id = NEW.workspace_id AND state = 'confirmed')
    OR EXISTS (SELECT 1 FROM annotation_items WHERE workspace_id = NEW.workspace_id AND state NOT IN ('confirmed', 'excluded'));
  SELECT RAISE(ABORT, 'revision item count mismatch') WHERE
    (SELECT count(*) FROM dataset_items WHERE revision_id = NEW.id)
      <> (SELECT count(*) FROM annotation_items WHERE workspace_id = NEW.workspace_id);
  SELECT RAISE(ABORT, 'revision item snapshot mismatch') WHERE EXISTS (
    SELECT 1 FROM dataset_items d LEFT JOIN annotation_items a ON a.id = d.source_item_id
    LEFT JOIN annotation_provenance_snapshots p ON p.item_id = a.id
    LEFT JOIN annotation_source_snapshots s ON s.import_id = a.import_id AND s.image_key = a.image_key
    WHERE d.revision_id = NEW.id AND (a.workspace_id IS NOT NEW.workspace_id
      OR d.import_id IS NOT a.import_id OR d.image_key IS NOT a.image_key OR d.image_sha256 IS NOT a.image_sha256
      OR d.width IS NOT a.width OR d.height IS NOT a.height OR d.annotation_json IS NOT a.annotation_json
      OR d.annotation_sha256 IS NOT a.annotation_sha256 OR d.provenance_json IS NOT p.snapshot_json
      OR d.source_snapshot_json IS NOT s.snapshot_json OR d.exclusion_reason IS NOT a.exclusion_reason
      OR d.disposition IS NOT CASE WHEN a.state = 'excluded' THEN 'excluded'
        WHEN a.negative_confirmed = 1 THEN 'negative' ELSE 'labeled' END));
  -- Full manifest item/schema equality and cryptographic validation: ANN-19.
  SELECT RAISE(ABORT, 'manifest identity/count mismatch') WHERE
    json_extract(NEW.manifest_json, '$.revisionId') IS NOT NEW.id
    OR json_extract(NEW.manifest_json, '$.workspaceId') IS NOT NEW.workspace_id
    OR json_extract(NEW.manifest_json, '$.itemCount') IS NOT (SELECT count(*) FROM dataset_items WHERE revision_id = NEW.id);
  SELECT RAISE(ABORT, 'same image hash cannot cross splits') WHERE EXISTS (
    SELECT 1 FROM dataset_items WHERE revision_id = NEW.id AND split IS NOT NULL
    GROUP BY image_sha256 HAVING count(DISTINCT split) > 1);
END;
CREATE TRIGGER dataset_revisions_freeze AFTER INSERT ON dataset_revisions BEGIN
  UPDATE annotation_workspaces SET state = 'frozen', edit_version = edit_version + 1,
    updated_at = NEW.confirmed_at WHERE id = NEW.workspace_id;
END;
CREATE TRIGGER dataset_revisions_update BEFORE UPDATE ON dataset_revisions BEGIN
  SELECT RAISE(ABORT, 'dataset revision immutable except Reference verification timestamp') WHERE
    OLD.mode <> 'reference' OR NEW.id IS NOT OLD.id OR NEW.project_id IS NOT OLD.project_id
    OR NEW.workspace_id IS NOT OLD.workspace_id OR NEW.revision_no IS NOT OLD.revision_no OR NEW.mode IS NOT OLD.mode
    OR NEW.manifest_json IS NOT OLD.manifest_json OR NEW.manifest_sha256 IS NOT OLD.manifest_sha256
    OR NEW.manifest_relative_path IS NOT OLD.manifest_relative_path OR NEW.schema_snapshot_json IS NOT OLD.schema_snapshot_json
    OR NEW.split_seed IS NOT OLD.split_seed OR NEW.created_by IS NOT OLD.created_by OR NEW.confirmed_at IS NOT OLD.confirmed_at;
END;
CREATE TRIGGER dataset_revisions_delete BEFORE DELETE ON dataset_revisions BEGIN
  SELECT RAISE(ABORT, 'dataset revision immutable');
END;

CREATE TRIGGER workspace_revision_sources_insert BEFORE INSERT ON workspace_revision_sources BEGIN
  SELECT RAISE(ABORT, 'lineage requires editable same-Project workspace and prior revision') WHERE
    EXISTS (SELECT 1 FROM workspace_revision_sources WHERE workspace_id = NEW.workspace_id AND source_revision_id = NEW.source_revision_id)
    OR NOT EXISTS (SELECT 1 FROM annotation_workspaces w JOIN dataset_revisions r ON r.project_id = w.project_id
      WHERE w.id = NEW.workspace_id AND r.id = NEW.source_revision_id AND w.state = 'editing');
END;
CREATE TRIGGER workspace_revision_sources_update BEFORE UPDATE ON workspace_revision_sources BEGIN
  SELECT RAISE(ABORT, 'lineage identity immutable; delete/insert while editing');
END;
CREATE TRIGGER workspace_revision_sources_delete BEFORE DELETE ON workspace_revision_sources
WHEN EXISTS (SELECT 1 FROM annotation_workspaces WHERE id = OLD.workspace_id AND state = 'frozen') BEGIN
  SELECT RAISE(ABORT, 'frozen lineage immutable');
END;

-- Protect referenced legacy identities against REPLACE even with recursion OFF.
-- Reference relink's UPDATE of path/OS identity remains allowed: old snapshots
-- retain old bindings and ANN-19 must verify current bytes before reuse.
-- UPDATE OR REPLACE can displace a referenced Project from an unreferenced row.
CREATE TRIGGER annotations_project_identity BEFORE UPDATE OF id, rowid, _rowid_, oid ON projects
WHEN NEW.id IS NOT OLD.id OR NEW.rowid IS NOT OLD.rowid BEGIN
  SELECT RAISE(ABORT, 'annotation Project identity immutable');
END;
-- Deferred FKs must not permit DELETE/reinsert to rebind existing annotations.
CREATE TRIGGER annotations_project_delete BEFORE DELETE ON projects
WHEN EXISTS (SELECT 1 FROM label_schemas WHERE project_id = OLD.id)
  OR EXISTS (SELECT 1 FROM annotation_workspaces WHERE project_id = OLD.id) BEGIN
  SELECT RAISE(ABORT, 'referenced annotation Project cannot be deleted');
END;
CREATE TRIGGER annotations_import_delete BEFORE DELETE ON data_imports
WHEN EXISTS (SELECT 1 FROM annotation_items WHERE import_id = OLD.id) BEGIN
  SELECT RAISE(ABORT, 'referenced annotation import cannot be deleted');
END;
CREATE TRIGGER annotations_source_delete BEFORE DELETE ON import_sources
WHEN EXISTS (SELECT 1 FROM annotation_items WHERE import_id = OLD.import_id AND image_key = OLD.image_key) BEGIN
  SELECT RAISE(ABORT, 'referenced annotation source cannot be deleted');
END;
CREATE TRIGGER annotations_project_task BEFORE UPDATE OF task_type ON projects
WHEN NEW.task_type IS NOT OLD.task_type AND EXISTS (SELECT 1 FROM annotation_workspaces WHERE project_id = OLD.id) BEGIN
  SELECT RAISE(ABORT, 'Project task has annotation workspaces');
END;
CREATE TRIGGER annotations_project_replace BEFORE INSERT ON projects
WHEN EXISTS (SELECT 1 FROM projects p JOIN label_schemas s ON s.project_id = p.id WHERE p.id = NEW.id OR p.rowid = NEW.rowid) BEGIN
  SELECT RAISE(ABORT, 'annotation Project replacement forbidden');
END;
CREATE TRIGGER annotations_import_replace BEFORE INSERT ON data_imports
WHEN EXISTS (SELECT 1 FROM data_imports d JOIN annotation_items a ON a.import_id = d.id
  WHERE d.id = NEW.id OR d.scan_job_id = NEW.scan_job_id OR d.rowid = NEW.rowid) BEGIN
  SELECT RAISE(ABORT, 'annotation import replacement forbidden');
END;
CREATE TRIGGER annotations_source_replace BEFORE INSERT ON import_sources
WHEN EXISTS (SELECT 1 FROM import_sources s JOIN annotation_items a ON a.import_id = s.import_id AND a.image_key = s.image_key
  WHERE s.rowid = NEW.rowid OR (s.import_id = NEW.import_id AND (s.image_key = NEW.image_key
    OR s.ordinal = NEW.ordinal OR s.relative_path_key = NEW.relative_path_key))) BEGIN
  SELECT RAISE(ABORT, 'annotation source replacement forbidden');
END;