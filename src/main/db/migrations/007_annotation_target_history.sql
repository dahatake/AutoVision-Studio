-- ANN-08: latest tombstone per item/target, NOT an event journal. No backfill:
-- already lost target identities cannot be reconstructed from scan class keys.
-- Main explicitly archives the ACTIVE preimage BEFORE updating annotation_items,
-- in the same transaction. Confirmed items may be read without unconfirming them.
-- Main owns canonical JSON, duplicate-key rejection and cryptographic SHA-256.
-- No model provenance until a future migration supplies real Suggestion FKs.
-- No class FK: the actual pre-delete class UUID must survive class removal.
-- Project deletion requires an explicit future migration, not deferred rebinding.

CREATE TABLE annotation_target_history (
  item_id TEXT NOT NULL REFERENCES annotation_items(id) ON DELETE NO ACTION,
  target_key TEXT NOT NULL CHECK (length(target_key) BETWEEN 1 AND 256),
  kind TEXT NOT NULL CHECK (kind IN ('manual', 'import-unmodified', 'import-edited')),
  source_import_id TEXT,
  source_image_key TEXT,
  source_annotation_key TEXT,
  source_suggestion_id TEXT CHECK (source_suggestion_id IS NULL),
  original_json TEXT NOT NULL CHECK (length(CAST(original_json AS BLOB)) <= 1048576
    AND json_valid(original_json) AND json_type(original_json) = 'object'),
  changes_json TEXT NOT NULL CHECK (length(CAST(changes_json AS BLOB)) <= 1048576
    AND json_valid(changes_json) AND json_type(changes_json) = 'object'),
  target_fields_json TEXT NOT NULL CHECK (length(CAST(target_fields_json AS BLOB)) <= 1048576
    AND json_valid(target_fields_json) AND json_type(target_fields_json) = 'object'),
  record_sha256 TEXT NOT NULL CHECK (length(record_sha256) = 64 AND record_sha256 NOT GLOB '*[^0-9a-fA-F]*'),
  PRIMARY KEY(item_id, target_key),
  FOREIGN KEY(source_import_id, source_image_key)
    REFERENCES import_sources(import_id, image_key) ON DELETE NO ACTION,
  CHECK ((source_import_id IS NULL) = (source_image_key IS NULL)),
  CHECK ((kind = 'manual' AND source_import_id IS NULL AND source_annotation_key IS NULL)
    OR (kind IN ('import-unmodified', 'import-edited') AND source_import_id IS NOT NULL
      AND source_annotation_key IS NOT NULL AND length(source_annotation_key) > 0))
) STRICT, WITHOUT ROWID;

-- Internal validation projection, not stored history or a restore API. A history
-- row need not remain in this view after the service removes its active target.
-- IS compares nullable origin fields and canonical JSON TEXT without rewriting.
CREATE VIEW annotation_target_history_active_matches AS
SELECT h.item_id, h.target_key
FROM annotation_target_history h
JOIN annotation_provenance p ON p.item_id = h.item_id AND p.target_key = h.target_key
JOIN annotation_items a ON a.id = p.item_id
JOIN annotation_workspaces w ON w.id = a.workspace_id
WHERE w.state = 'editing'
  AND h.kind IS p.kind
  AND h.source_import_id IS p.source_import_id
  AND h.source_image_key IS p.source_image_key
  AND h.source_annotation_key IS p.source_annotation_key
  AND h.source_suggestion_id IS p.source_suggestion_id
  AND h.original_json IS p.original_json AND h.changes_json IS p.changes_json
  AND (h.source_import_id IS NULL OR
    (h.source_import_id IS a.import_id AND h.source_image_key IS a.image_key))
  AND (
    (w.task_type = 'classification' AND json_extract(a.annotation_json, '$.kind') = 'classification'
      AND h.target_key = 'classification'
      AND (SELECT count(*) FROM json_each(h.target_fields_json)) = 1
      AND json_type(h.target_fields_json, '$.classId') = 'text'
      AND json_type(a.annotation_json, '$.classId') = 'text'
      AND json_extract(h.target_fields_json, '$.classId') IS json_extract(a.annotation_json, '$.classId'))
    OR (w.task_type = 'detection' AND json_extract(a.annotation_json, '$.kind') = 'detection'
      AND (SELECT count(*) FROM json_each(h.target_fields_json)) = 5
      AND (SELECT count(DISTINCT key) FROM json_each(h.target_fields_json)) = 5
      AND json_type(h.target_fields_json, '$.classId') = 'text'
      AND json_type(h.target_fields_json, '$.x') IN ('integer', 'real')
      AND json_type(h.target_fields_json, '$.y') IN ('integer', 'real')
      AND json_type(h.target_fields_json, '$.width') IN ('integer', 'real')
      AND json_type(h.target_fields_json, '$.height') IN ('integer', 'real')
      AND (SELECT count(*) FROM json_each(a.annotation_json, '$.rectangles') r
        WHERE json_extract(r.value, '$.id') = h.target_key) = 1
      AND EXISTS (SELECT 1 FROM json_each(a.annotation_json, '$.rectangles') r
        WHERE r.type = 'object' AND json_type(r.value, '$.id') = 'text'
          AND json_extract(r.value, '$.id') = h.target_key
          AND json_type(r.value, '$.classId') = 'text'
          AND json_type(r.value, '$.x') IN ('integer', 'real')
          AND json_type(r.value, '$.y') IN ('integer', 'real')
          AND json_type(r.value, '$.width') IN ('integer', 'real')
          AND json_type(r.value, '$.height') IN ('integer', 'real')
          AND json_extract(h.target_fields_json, '$.classId') IS json_extract(r.value, '$.classId')
          AND json_extract(h.target_fields_json, '$.x') IS json_extract(r.value, '$.x')
          AND json_extract(h.target_fields_json, '$.y') IS json_extract(r.value, '$.y')
          AND json_extract(h.target_fields_json, '$.width') IS json_extract(r.value, '$.width')
          AND json_extract(h.target_fields_json, '$.height') IS json_extract(r.value, '$.height')))
  );

CREATE TRIGGER annotation_target_history_no_replace BEFORE INSERT ON annotation_target_history
WHEN EXISTS (SELECT 1 FROM annotation_target_history WHERE item_id = NEW.item_id AND target_key = NEW.target_key) BEGIN
  -- Must run before REPLACE's implicit delete even with recursive_triggers OFF.
  -- Use explicit INSERT for first archive, explicit UPDATE for subsequent ones.
  SELECT RAISE(ABORT, 'target history replacement forbidden');
END;
CREATE TRIGGER annotation_target_history_insert AFTER INSERT ON annotation_target_history BEGIN
  SELECT RAISE(ABORT, 'target history requires exact active preimage in editing workspace')
    WHERE NOT EXISTS (SELECT 1 FROM annotation_target_history_active_matches
      WHERE item_id = NEW.item_id AND target_key = NEW.target_key);
END;
CREATE TRIGGER annotation_target_history_identity BEFORE UPDATE ON annotation_target_history BEGIN
  SELECT RAISE(ABORT, 'target history origin immutable') WHERE
    NEW.item_id IS NOT OLD.item_id OR NEW.target_key IS NOT OLD.target_key
    OR NEW.source_import_id IS NOT OLD.source_import_id OR NEW.source_image_key IS NOT OLD.source_image_key
    OR NEW.source_annotation_key IS NOT OLD.source_annotation_key
    OR NEW.source_suggestion_id IS NOT OLD.source_suggestion_id
    OR NEW.original_json IS NOT OLD.original_json
    OR NOT (NEW.kind IS OLD.kind OR (OLD.kind = 'import-unmodified' AND NEW.kind = 'import-edited'));
END;
CREATE TRIGGER annotation_target_history_update AFTER UPDATE ON annotation_target_history BEGIN
  SELECT RAISE(ABORT, 'target history requires exact active preimage in editing workspace')
    WHERE NOT EXISTS (SELECT 1 FROM annotation_target_history_active_matches
      WHERE item_id = NEW.item_id AND target_key = NEW.target_key);
END;
CREATE TRIGGER annotation_target_history_delete BEFORE DELETE ON annotation_target_history BEGIN
  SELECT RAISE(ABORT, 'target history deletion forbidden');
END;
CREATE TRIGGER annotation_target_history_item_delete BEFORE DELETE ON annotation_items
WHEN EXISTS (SELECT 1 FROM annotation_target_history WHERE item_id = OLD.id) BEGIN
  SELECT RAISE(ABORT, 'item referenced by target history cannot be deleted');
END;