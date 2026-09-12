// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AnnotationItem, AnnotationProvenance, AnnotationWorkspace } from '../../shared/contracts/annotation.js';
import { openDatabase } from '../db/database.js';
import { annotationDigest } from './workspace-repository.js';
import { annotationTargets, prepareTargetHistory } from './target-history.js';

const id = '11111111-1111-4111-8111-111111111111';
const classId = '22222222-2222-4222-8222-222222222222';
const now = '2026-09-13T00:00:00.000Z';
const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});
// Focused SQL007 unit fixture: minimal parent shapes, real view and triggers.
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'autovision-target-history-'));
  directories.push(directory);
  const database = openDatabase(join(directory, 'metadata.sqlite3'));
  database.exec(`CREATE TABLE import_sources(import_id TEXT,image_key TEXT,PRIMARY KEY(import_id,image_key));
    CREATE TABLE annotation_workspaces(id TEXT PRIMARY KEY,state TEXT,task_type TEXT);
    CREATE TABLE annotation_items(id TEXT PRIMARY KEY,workspace_id TEXT,import_id TEXT,image_key TEXT,annotation_json TEXT);
    CREATE TABLE annotation_provenance(item_id TEXT,target_key TEXT,kind TEXT,source_import_id TEXT,source_image_key TEXT,
      source_annotation_key TEXT,source_suggestion_id TEXT,original_json TEXT,changes_json TEXT);
    INSERT INTO annotation_workspaces VALUES ('${id}','editing','classification');
    INSERT INTO annotation_items VALUES ('${id}','${id}','${id}','image:0','{"classId":"${classId}","kind":"classification"}');
    INSERT INTO annotation_provenance VALUES ('${id}','classification','manual',NULL,NULL,NULL,NULL,'{}','{"10":1,"2":2}');`);
  database.exec(readFileSync(new URL('../db/migrations/007_annotation_target_history.sql', import.meta.url), 'utf8'));
  const workspace: AnnotationWorkspace = { id, projectId: id, schemaId: id, mode: 'copy', taskType: 'classification',
    state: 'editing', editVersion: 0, createdAt: now, updatedAt: now };
  const item: AnnotationItem = { id, workspaceId: id, importId: id, imageKey: 'image:0', imageSha256: 'a'.repeat(64),
    width: 100, height: 100, annotation: { kind: 'classification', classId }, annotationSha256: 'b'.repeat(64),
    state: 'editing', negativeConfirmed: false, exclusionReason: null, editVersion: 0, confirmedAt: null, updatedAt: now };
  const provenance: AnnotationProvenance[] = [{ itemId: id, targetKey: 'classification', kind: 'manual', sourceImportId: null,
    sourceImageKey: null, sourceAnnotationKey: null, sourceSuggestionId: null, original: {}, changes: { '10': 1, '2': 2 } }];
  return { database, workspace, previous: { item, provenance } };
}

describe('ANN08 target history SQL007 units', () => {
  it('projects classification and rectangles without including rectangle identity in fields', () => {
    expect(annotationTargets({ kind: 'classification', classId: null }).size).toBe(0);
    expect(annotationTargets({ kind: 'detection', rectangles: [{ id, classId, x: 1, y: 2, width: 3, height: 4 }] }).get(id))
      .toEqual({ classId, x: 1, y: 2, width: 3, height: 4 });
  });
  it('archives canonical integer keys and hashes the entire envelope, retaining history on restore', () => {
    const { database, workspace, previous } = fixture();
    try {
      database.exec('BEGIN');
      const prepared = prepareTargetHistory(database, workspace, previous, { kind: 'classification', classId: null });
      prepared.assertSnapshot();
      const saved = database.prepare('SELECT changes_json,target_fields_json,record_sha256 FROM annotation_target_history').get() as Record<string, string>;
      expect(saved['changes_json']).toBe('{"10":1,"2":2}');
      expect(saved['target_fields_json']).toBe(`{"classId":"${classId}"}`);
      const envelope = `{"changes":{"10":1,"2":2},"itemId":"${id}","kind":"manual","original":{},"sourceAnnotationKey":null,"sourceImageKey":null,"sourceImportId":null,"sourceSuggestionId":null,"targetFields":{"classId":"${classId}"},"targetKey":"classification"}`;
      expect(saved['record_sha256']).toBe(annotationDigest(envelope));
      database.prepare('UPDATE annotation_items SET annotation_json=?').run('{"classId":null,"kind":"classification"}');
      database.exec('DELETE FROM annotation_provenance');
      const restored = prepareTargetHistory(database, workspace, { item: { ...previous.item, annotation: { kind: 'classification', classId: null } }, provenance: [] }, previous.item.annotation);
      expect(restored.restored.get('classification')?.provenance).toEqual(previous.provenance[0]);
      restored.assertSnapshot();
      expect(database.prepare('SELECT count(*) AS n FROM annotation_target_history').get()).toEqual({ n: 1 });
    } finally { if (database.inTransaction) database.exec('ROLLBACK'); database.close(); }
  });
  it('rejects caller transactions missing and missing active provenance without writing', () => {
    const { database, workspace, previous } = fixture();
    try {
      expect(() => prepareTargetHistory(database, workspace, previous, { kind: 'classification', classId: null })).toThrow(/transaction/);
      database.exec('BEGIN');
      expect(() => prepareTargetHistory(database, workspace, { ...previous, provenance: [] }, { kind: 'classification', classId: null })).toThrow();
      expect(database.prepare('SELECT count(*) AS n FROM annotation_target_history').get()).toEqual({ n: 0 });
    } finally { if (database.inTransaction) database.exec('ROLLBACK'); database.close(); }
  });
  it('detects fresh history mutation rather than trusting the archive write result', () => {
    const { database, workspace, previous } = fixture();
    try {
      database.exec('BEGIN');
      const prepared = prepareTargetHistory(database, workspace, previous, { kind: 'classification', classId: null });
      // Hash alone is not validated by SQL; Main must compare the final snapshot.
      database.prepare('UPDATE annotation_target_history SET record_sha256=?').run('f'.repeat(64));
      expect(() => prepared.assertSnapshot()).toThrow(/history/);
    } finally { if (database.inTransaction) database.exec('ROLLBACK'); database.close(); }
  });
});