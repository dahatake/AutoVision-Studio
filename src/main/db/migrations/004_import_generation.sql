-- DAT-12: persistent per-import ABA detection. migrateDatabase owns the transaction.
-- Deliberately no foreign key: deleted headers leave permanent tombstones.
-- No hidden rowid through which REPLACE could delete a different import_id.
CREATE TABLE import_generations (
  import_id TEXT PRIMARY KEY,
  generation INTEGER NOT NULL CHECK (
    typeof(generation) = 'integer' AND generation BETWEEN 1 AND 9223372036854775807
  )
) STRICT, WITHOUT ROWID;

-- Do not rewrite any header/source columns, JSON bytes or hashes on upgrade.
INSERT INTO import_generations(import_id, generation) SELECT id, 1 FROM data_imports;

-- REPLACE's implicit rowid deletion can bypass DELETE triggers. Permit ordinary
-- same-import replacement, but never let it displace another import. An unset
-- NEW.rowid may be -1; an actual cross-import collision still fails closed.
CREATE TRIGGER data_imports_guard_rowid_insert
BEFORE INSERT ON data_imports
WHEN EXISTS (SELECT 1 FROM data_imports WHERE rowid = NEW.rowid AND id IS NOT NEW.id)
BEGIN
  SELECT RAISE(ABORT, 'data_imports rowid belongs to another import');
END;

CREATE TRIGGER data_imports_guard_rowid_update
BEFORE UPDATE OF rowid, _rowid_, oid ON data_imports
BEGIN
  SELECT RAISE(ABORT, 'data_imports rowid is immutable');
END;

CREATE TRIGGER import_sources_guard_rowid_insert
BEFORE INSERT ON import_sources
WHEN EXISTS (
  SELECT 1 FROM import_sources WHERE rowid = NEW.rowid AND import_id IS NOT NEW.import_id
)
BEGIN
  SELECT RAISE(ABORT, 'import_sources rowid belongs to another import');
END;

CREATE TRIGGER import_sources_guard_rowid_update
BEFORE UPDATE OF rowid, _rowid_, oid ON import_sources
BEGIN
  SELECT RAISE(ABORT, 'import_sources rowid is immutable');
END;

-- BEFORE INSERT also runs for REPLACE with recursive_triggers OFF, before its
-- implicit deletion. A DELETE guard alone cannot protect against that path.
CREATE TRIGGER import_generations_guard_insert
BEFORE INSERT ON import_generations
BEGIN
  SELECT RAISE(ABORT, 'import generation already exists')
    WHERE EXISTS (SELECT 1 FROM import_generations WHERE import_id = NEW.import_id);
  SELECT RAISE(ABORT, 'import generation must start at one')
    WHERE typeof(NEW.generation) <> 'integer' OR NEW.generation <> 1;
END;

CREATE TRIGGER import_generations_guard_update
BEFORE UPDATE ON import_generations
WHEN NEW.import_id IS NOT OLD.import_id
  OR typeof(NEW.generation) <> 'integer'
  OR NEW.generation IS NOT CASE
    WHEN OLD.generation < 9223372036854775807 THEN OLD.generation + 1
  END
BEGIN
  SELECT RAISE(ABORT, 'import generation requires exactly one increment');
END;

CREATE TRIGGER import_generations_guard_delete
BEFORE DELETE ON import_generations
BEGIN
  SELECT RAISE(ABORT, 'import generation tombstone cannot be deleted');
END;

-- REPLACE can displace a DIFFERENT import through UNIQUE(scan_job_id).
-- Its implicit DELETE might not fire triggers, so preserve that import's ABA
-- evidence too. Failed ordinary INSERT statements roll this increment back.
CREATE TRIGGER data_imports_generation_displaced
BEFORE INSERT ON data_imports
BEGIN
  UPDATE import_generations SET generation = CASE
    WHEN generation < 9223372036854775807 THEN generation + 1
    ELSE RAISE(ABORT, 'import generation exhausted') END
  WHERE import_id IN (
    SELECT id FROM data_imports WHERE scan_job_id = NEW.scan_job_id AND id <> NEW.id
  );
END;

CREATE TRIGGER data_imports_generation_insert
AFTER INSERT ON data_imports
BEGIN
  UPDATE import_generations SET generation = CASE
    WHEN generation < 9223372036854775807 THEN generation + 1
    ELSE RAISE(ABORT, 'import generation exhausted') END
  WHERE import_id = NEW.id;
  INSERT INTO import_generations(import_id, generation)
    SELECT NEW.id, 1 WHERE NOT EXISTS (
      SELECT 1 FROM import_generations WHERE import_id = NEW.id
    );
END;

CREATE TRIGGER data_imports_generation_update
AFTER UPDATE ON data_imports
BEGIN
  UPDATE import_generations SET generation = CASE
    WHEN generation < 9223372036854775807 THEN generation + 1
    ELSE RAISE(ABORT, 'import generation exhausted') END
  WHERE import_id = NEW.id;
END;

CREATE TRIGGER data_imports_generation_delete
AFTER DELETE ON data_imports
BEGIN
  UPDATE import_generations SET generation = CASE
    WHEN generation < 9223372036854775807 THEN generation + 1
    ELSE RAISE(ABORT, 'import generation exhausted') END
  WHERE import_id = OLD.id;
END;

CREATE TRIGGER import_sources_generation_insert
AFTER INSERT ON import_sources
BEGIN
  UPDATE import_generations SET generation = CASE
    WHEN generation < 9223372036854775807 THEN generation + 1
    ELSE RAISE(ABORT, 'import generation exhausted') END
  WHERE import_id = NEW.import_id;
END;

CREATE TRIGGER import_sources_generation_update
AFTER UPDATE ON import_sources
BEGIN
  UPDATE import_generations SET generation = CASE
    WHEN generation < 9223372036854775807 THEN generation + 1
    ELSE RAISE(ABORT, 'import generation exhausted') END
  WHERE import_id = NEW.import_id;
END;

CREATE TRIGGER import_sources_generation_delete
AFTER DELETE ON import_sources
BEGIN
  UPDATE import_generations SET generation = CASE
    WHEN generation < 9223372036854775807 THEN generation + 1
    ELSE RAISE(ABORT, 'import generation exhausted') END
  WHERE import_id = OLD.import_id;
END;