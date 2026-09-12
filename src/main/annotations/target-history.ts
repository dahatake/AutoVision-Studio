import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  MAX_ANNOTATION_JSON_BYTES, annotationProvenanceSchema, annotationSchema,
  type Annotation, type AnnotationItem, type AnnotationJsonObject, type AnnotationJsonValue,
  type AnnotationProvenance, type AnnotationWorkspace,
} from '../../shared/contracts/annotation.js';
import { findDataImport } from '../data/import-repository.js';
import type { DatabaseConnection } from '../db/database.js';
import { annotationDigest } from './workspace-repository.js';

function invalid(): never { throw new Error('Invalid annotation target history.'); }
// Emit directly: rebuilding objects would reorder integer-like keys.
function canonical(value: AnnotationJsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key]!)}`).join(',')}}`;
}
function decode(text: string): AnnotationJsonObject {
  if (Buffer.byteLength(text, 'utf8') > MAX_ANNOTATION_JSON_BYTES) return invalid();
  const value: AnnotationJsonValue = JSON.parse(text) as AnnotationJsonValue;
  if (value === null || typeof value !== 'object' || Array.isArray(value) || canonical(value) !== text) return invalid();
  return value;
}
export function annotationTargets(annotation: Annotation): Map<string, AnnotationJsonObject> {
  return annotation.kind === 'classification'
    ? new Map(annotation.classId === null ? [] : [['classification', { classId: annotation.classId }]])
    : new Map(annotation.rectangles.map(({ id, ...fields }) => [id, fields]));
}
export interface TargetHistoryEntry {
  readonly provenance: AnnotationProvenance;
  readonly targetFields: AnnotationJsonObject;
}
const rowSchema = z.strictObject({
  itemId: z.string(), targetKey: z.string(), kind: z.string(),
  sourceImportId: z.string().nullable(), sourceImageKey: z.string().nullable(),
  sourceAnnotationKey: z.string().nullable(), sourceSuggestionId: z.string().nullable(),
  originalJson: z.string(), changesJson: z.string(), targetFieldsJson: z.string(),
  recordSha256: z.string().regex(/^[a-f0-9]{64}(?![\s\S])/u),
});
const select = `SELECT item_id AS itemId,target_key AS targetKey,kind,
  source_import_id AS sourceImportId,source_image_key AS sourceImageKey,
  source_annotation_key AS sourceAnnotationKey,source_suggestion_id AS sourceSuggestionId,
  original_json AS originalJson,changes_json AS changesJson,target_fields_json AS targetFieldsJson,
  record_sha256 AS recordSha256 FROM annotation_target_history WHERE item_id=? ORDER BY target_key`;
function digest(entry: TargetHistoryEntry): string {
  return annotationDigest(canonical({ ...entry.provenance, targetFields: entry.targetFields }));
}
function row(entry: TargetHistoryEntry): z.infer<typeof rowSchema> {
  const { original, changes, ...fields } = entry.provenance;
  const originalJson = canonical(original), changesJson = canonical(changes), targetFieldsJson = canonical(entry.targetFields);
  for (const text of [originalJson, changesJson, targetFieldsJson]) {
    if (Buffer.byteLength(text, 'utf8') > MAX_ANNOTATION_JSON_BYTES) invalid();
  }
  return { ...fields, originalJson, changesJson, targetFieldsJson, recordSha256: digest(entry) };
}

/** Main-only. previous MUST be the genuine readWorkspaceItem result in this TX.
 * No caller history/origin, no coordinate matching, no ordered event log.
 * Rows survive restoration; only the next deletion replaces their latest state.
 */
export function prepareTargetHistory(database: DatabaseConnection, workspace: AnnotationWorkspace,
  previous: { item: AnnotationItem; provenance: readonly AnnotationProvenance[] }, next: Annotation): {
    restored: ReadonlyMap<string, TargetHistoryEntry>; assertSnapshot: () => void;
  } {
  if (!database.inTransaction) throw new Error('Target history requires the save transaction.');
  const item = previous.item, before = annotationTargets(item.annotation), after = annotationTargets(next);
  const raw = database.prepare(select).all(item.id).map((value) => rowSchema.parse(value));
  // The workspace reader already validates the active projection. Decode the
  // genuine immutable import once for the entire stored-history batch only.
  const source = raw.some((value) => value.kind !== 'manual')
    ? findDataImport(database, workspace.projectId, item.importId) : null;
  const image = source?.scanResult.images.find((value) => value.key === item.imageKey);
  const original = image?.annotation;
  const boxes = new Map(original?.type === 'detection' ? original.boxes.map((box) => [box.sourceAnnotationId, box]) : []);
  const history = new Map<string, TargetHistoryEntry>();
  const expected = new Map(raw.map((value) => [value.targetKey, value]));
  for (const value of raw) {
    const { originalJson, changesJson, targetFieldsJson, recordSha256, ...fields } = value;
    const provenance = annotationProvenanceSchema.parse({ ...fields, original: decode(originalJson), changes: decode(changesJson) });
    const targetFields = decode(targetFieldsJson);
    const entry = { provenance, targetFields };
    if (provenance.itemId !== item.id || history.has(provenance.targetKey) || provenance.kind.startsWith('model-')
      || digest(entry) !== recordSha256) invalid();
    // Reuse the actual annotation schema, including strict field/UUID checks.
    // Deliberately do not require historical class membership after a merge.
    const annotation = annotationSchema.parse(workspace.taskType === 'classification'
      ? { kind: 'classification', ...targetFields } : { kind: 'detection', rectangles: [{ id: provenance.targetKey, ...targetFields }] });
    const normalized = annotationTargets(annotation).get(provenance.targetKey);
    if (!normalized || !isDeepStrictEqual(normalized, targetFields)) invalid();
    if (annotation.kind === 'detection' && annotation.rectangles.some((r) => r.width > item.width - r.x || r.height > item.height - r.y)) invalid();
    if (provenance.kind === 'import-unmodified' && Object.keys(provenance.changes).length !== 0) invalid();
    if (provenance.kind !== 'manual') {
      if (!source || source.projectId !== workspace.projectId || source.taskType !== workspace.taskType || source.mode !== workspace.mode
        || !image || image.sha256 !== item.imageSha256 || image.width !== item.width || image.height !== item.height
        || provenance.sourceImportId !== item.importId || provenance.sourceImageKey !== item.imageKey || !original) invalid();
      if (original.type === 'classification') {
        if (provenance.targetKey !== 'classification' || provenance.sourceAnnotationKey !== (original.sourceRow === null ? 'classification' : `row:${original.sourceRow}`)
          || canonical(provenance.original) !== canonical(original)) invalid();
      } else {
        const box = boxes.get(provenance.sourceAnnotationKey!);
        if (!box || canonical(provenance.original) !== canonical({ type: 'detection', sourceImageId: original.sourceImageId, ...box })) invalid();
        if (provenance.kind === 'import-unmodified' && (targetFields['x'] !== box.bbox[0] || targetFields['y'] !== box.bbox[1]
          || targetFields['width'] !== box.bbox[2] || targetFields['height'] !== box.bbox[3])) invalid();
      }
    }
    history.set(provenance.targetKey, entry);
  }
  const restored = new Map([...history].filter(([key]) => !before.has(key) && after.has(key)));
  const origins = new Map(previous.provenance.map((value) => [value.targetKey, value]));
  for (const [key, targetFields] of before) {
    if (after.has(key)) continue;
    const provenance = origins.get(key);
    if (!provenance) invalid(); // Never repair a missing active provenance.
    const entry = { provenance, targetFields }, archived = row(entry), existing = history.get(key);
    if (existing) {
      const { kind: oldKind, changes: oldChanges, ...oldOrigin } = existing.provenance;
      const { kind, changes, ...origin } = provenance;
      void oldChanges; void changes;
      if (!isDeepStrictEqual(oldOrigin, origin) || !(kind === oldKind || (oldKind === 'import-unmodified' && kind === 'import-edited'))) invalid();
    }
    // SQL 007 compares against the still-active item/provenance BEFORE UPDATE.
    const result = existing
      ? database.prepare(`UPDATE annotation_target_history SET kind=?,changes_json=?,target_fields_json=?,record_sha256=? WHERE item_id=? AND target_key=?`)
        .run(archived.kind, archived.changesJson, archived.targetFieldsJson, archived.recordSha256, item.id, key)
      : database.prepare(`INSERT INTO annotation_target_history
        (item_id,target_key,kind,source_import_id,source_image_key,source_annotation_key,source_suggestion_id,original_json,changes_json,target_fields_json,record_sha256)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(archived.itemId, key, archived.kind, archived.sourceImportId, archived.sourceImageKey,
        archived.sourceAnnotationKey, archived.sourceSuggestionId, archived.originalJson, archived.changesJson, archived.targetFieldsJson, archived.recordSha256);
    if (result.changes !== 1) invalid();
    expected.set(key, archived);
  }
  return { restored, assertSnapshot: () => {
    const fresh = database.prepare(select).all(item.id).map((value) => rowSchema.parse(value));
    if (!isDeepStrictEqual(new Map(fresh.map((value) => [value.targetKey, value])), expected)) invalid();
  } };
}