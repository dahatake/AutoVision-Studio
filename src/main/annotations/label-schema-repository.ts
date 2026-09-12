import { createHash } from 'node:crypto';

import {
  annotationItemSchema, annotationProvenanceSchema, annotationSchema, labelSchemaSnapshotSchema,
  MAX_ANNOTATION_JSON_BYTES, MAX_LABEL_EXAMPLES_JSON_BYTES,
  type Annotation, type AnnotationJsonObject, type AnnotationJsonValue,
  type AnnotationProvenance, type LabelClass, type LabelSchemaSnapshot,
} from '../../shared/contracts/annotation.js';
import type { DatabaseConnection } from '../db/database.js';

export type LabelSchemaErrorCode = 'LABEL_INPUT' | 'LABEL_DATABASE' | 'LABEL_TRANSACTION'
  | 'LABEL_PROJECT_NOT_FOUND' | 'LABEL_SCHEMA_NOT_FOUND' | 'LABEL_CLASS_NOT_FOUND'
  | 'LABEL_CONFLICT' | 'LABEL_LOCKED' | 'LABEL_DUPLICATE_NAME' | 'LABEL_ORDINAL_CONFLICT'
  | 'LABEL_CLASS_USED' | 'LABEL_HISTORY_REFERENCE' | 'LABEL_STORED_DATA';
export class LabelSchemaError extends Error {
  constructor(readonly code: LabelSchemaErrorCode) { super('Label schema operation failed.'); }
}
export function labelFailure(code: LabelSchemaErrorCode): never { throw new LabelSchemaError(code); }

// Bound actual stored bytes before parsing. JSON.parse alone discards duplicate
// keys; scan its already-valid token stream, comparing decoded property names.
function storedJson(text: string, maximum: number): unknown {
  try {
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > maximum) throw new Error();
    const value: unknown = JSON.parse(text);
    const stack: (Set<string> | null)[] = [];
    const tokens = /"(?:[^"\\]|\\[\s\S])*"|[{}\[\]:,]/gu;
    for (const match of text.matchAll(tokens)) {
      const token = match[0];
      if (token === '{') stack.push(new Set());
      else if (token === '[') stack.push(null);
      else if (token === '}' || token === ']') stack.pop();
      else if (token.startsWith('"') && /^\s*:/u.test(text.slice(match.index + token.length))) {
        const keys = stack.at(-1);
        const key = JSON.parse(token) as string;
        if (!keys || keys.has(key)) throw new Error();
        keys.add(key);
      }
    }
    return value;
  } catch { return labelFailure('LABEL_STORED_DATA'); }
}

/** Main-only canonical content encoding for ANN-03 and future ANN-05 callers.
 * Lexicographically ordered known object fields; array order is significant.
 * UTF-8 JSON, no whitespace/newline; SHA-256 is lowercase hex of exactly json.
 * Not the SQL revision snapshot projection, nor a generic JSON hash API.
 */
export function encodeCanonicalAnnotation(value: Annotation): { json: string; sha256: string } {
  const parsed = annotationSchema.parse(value);
  const ordered = parsed.kind === 'classification' ? { classId: parsed.classId, kind: parsed.kind }
    : { kind: parsed.kind, rectangles: parsed.rectangles.map((r) => ({
      classId: r.classId, height: r.height, id: r.id, width: r.width, x: r.x, y: r.y,
    })) };
  const json = JSON.stringify(ordered);
  return { json, sha256: createHash('sha256').update(json, 'utf8').digest('hex') };
}

// Only schema-guarded provenance trees. Emit sorted key tokens directly so
// integer-like keys cannot be reordered by object reconstruction; retain arrays.
function canonicalProvenanceJson(value: AnnotationJsonObject): string {
  function encode(child: AnnotationJsonValue): string {
    if (child === null || typeof child !== 'object') return JSON.stringify(child);
    if (Array.isArray(child)) return `[${child.map(encode).join(',')}]`;
    return `{${Object.keys(child).sort().map((key) => `${JSON.stringify(key)}:${encode(child[key]!)}`).join(',')}}`;
  }
  try { return encode(value); } catch { return labelFailure('LABEL_STORED_DATA'); }
}

const referencesClass = `(json_extract(a.annotation_json,'$.classId')=? OR EXISTS
  (SELECT 1 FROM json_each(a.annotation_json,'$.rectangles') r WHERE json_extract(r.value,'$.classId')=?))`;

/** Internal SQL surface. Caller owns a synchronous transaction, input validation
 * and CAS. Never expose this connection/repository through Renderer or IPC. */
export class LabelSchemaRepository {
  constructor(private readonly database: DatabaseConnection) {}

  requireProject(projectId: string): void {
    if (!this.database.prepare('SELECT id FROM projects WHERE id=?').get(projectId)) labelFailure('LABEL_PROJECT_NOT_FOUND');
  }

  find(projectId: string): LabelSchemaSnapshot | undefined {
    const header = this.database.prepare(`SELECT id,project_id AS projectId,instructions,locked_at AS lockedAt,
      edit_version AS editVersion,created_at AS createdAt,updated_at AS updatedAt
      FROM label_schemas WHERE project_id=?`).get(projectId) as { id: string } | undefined;
    if (!header) return undefined;
    const rows = this.database.prepare(`SELECT id,schema_id AS schemaId,display_name AS displayName,
      normalized_name AS normalizedName,model_alias AS modelAlias,color,description,examples_json AS examplesJson,
      ordinal,created_at AS createdAt,updated_at AS updatedAt FROM label_classes WHERE schema_id=? ORDER BY ordinal,id`)
      .all(header.id) as { examplesJson: string }[];
    const classes = rows.map(({ examplesJson, ...row }) => ({ ...row, examples: storedJson(examplesJson, MAX_LABEL_EXAMPLES_JSON_BYTES) }));
    const parsed = labelSchemaSnapshotSchema.safeParse({ ...header, classes });
    if (!parsed.success) return labelFailure('LABEL_STORED_DATA');
    return parsed.data;
  }

  insert(snapshot: LabelSchemaSnapshot): void {
    this.database.prepare(`INSERT INTO label_schemas(id,project_id,instructions,created_at,updated_at)
      VALUES (?,?,'',?,?)`).run(snapshot.id, snapshot.projectId, snapshot.createdAt, snapshot.updatedAt);
  }

  bump(snapshot: LabelSchemaSnapshot, at: string, instructions = snapshot.instructions, lock = false): void {
    const result = this.database.prepare(`UPDATE label_schemas SET instructions=?,locked_at=?,
      edit_version=edit_version+1,updated_at=? WHERE id=? AND project_id=? AND edit_version=? AND locked_at IS NULL`)
      .run(instructions, lock ? at : null, at, snapshot.id, snapshot.projectId, snapshot.editVersion);
    if (result.changes !== 1) labelFailure('LABEL_CONFLICT');
  }

  writeClass(value: LabelClass, create: boolean): void {
    if (create) {
      this.database.prepare(`INSERT INTO label_classes(id,schema_id,display_name,normalized_name,model_alias,
        color,description,examples_json,ordinal,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`)
        .run(value.id, value.schemaId, value.displayName, value.normalizedName, value.modelAlias, value.color,
          value.description, JSON.stringify(value.examples), value.ordinal, value.createdAt, value.updatedAt);
    } else {
      const result = this.database.prepare(`UPDATE label_classes SET display_name=?,normalized_name=?,model_alias=?,
        color=?,description=?,examples_json=?,ordinal=?,updated_at=? WHERE id=? AND schema_id=?`)
        .run(value.displayName, value.normalizedName, value.modelAlias, value.color, value.description,
          JSON.stringify(value.examples), value.ordinal, value.updatedAt, value.id, value.schemaId);
      if (result.changes !== 1) labelFailure('LABEL_CLASS_NOT_FOUND');
    }
  }

  removeClass(schemaId: string, classId: string): void {
    // All states/workspaces, including drafts and frozen items; never clear labels.
    if (this.database.prepare(`SELECT 1 FROM annotation_items a WHERE ${referencesClass} LIMIT 1`)
      .get(classId, classId)) labelFailure('LABEL_CLASS_USED');
    const result = this.database.prepare('DELETE FROM label_classes WHERE id=? AND schema_id=?').run(classId, schemaId);
    if (result.changes !== 1) labelFailure('LABEL_CLASS_NOT_FOUND');
  }

  mergeReferences(snapshot: LabelSchemaSnapshot, sourceId: string, targetId: string, at: string): void {
    if (this.database.prepare(`SELECT 1 FROM annotation_items a JOIN annotation_workspaces w ON w.id=a.workspace_id
      WHERE w.state='frozen' AND ${referencesClass} LIMIT 1`).get(sourceId, sourceId)
      || this.database.prepare(`SELECT 1 FROM dataset_items a WHERE ${referencesClass} LIMIT 1`).get(sourceId, sourceId)) {
      labelFailure('LABEL_HISTORY_REFERENCE');
    }
    const rows = this.database.prepare(`SELECT a.id,a.workspace_id AS workspaceId,a.import_id AS importId,
      a.image_key AS imageKey,a.image_sha256 AS imageSha256,a.width,a.height,a.annotation_json AS annotationJson,
      a.annotation_sha256 AS annotationSha256,a.state,a.negative_confirmed AS negativeConfirmed,
      a.exclusion_reason AS exclusionReason,a.edit_version AS editVersion,a.confirmed_at AS confirmedAt,
      a.updated_at AS updatedAt,w.edit_version AS workspaceVersion,w.updated_at AS workspaceUpdatedAt
      FROM annotation_items a JOIN annotation_workspaces w ON w.id=a.workspace_id
      WHERE w.project_id=? AND w.schema_id=? AND w.state='editing' AND ${referencesClass} ORDER BY a.id`)
      .all(snapshot.projectId, snapshot.id, sourceId, sourceId) as (Record<string, unknown> & {
        annotationJson: string; negativeConfirmed: number; workspaceVersion: number; workspaceUpdatedAt: string;
      })[];
    const workspaces = new Map<string, { version: number; updatedAt: string }>();
    for (const { annotationJson, negativeConfirmed, workspaceVersion, workspaceUpdatedAt, ...row } of rows) {
      const parsed = annotationItemSchema.safeParse({ ...row, negativeConfirmed: negativeConfirmed === 1,
        annotation: storedJson(annotationJson, MAX_ANNOTATION_JSON_BYTES) });
      if (!parsed.success) labelFailure('LABEL_STORED_DATA');
      const item = parsed.data;
      if (createHash('sha256').update(annotationJson, 'utf8').digest('hex') !== item.annotationSha256
        || encodeCanonicalAnnotation(item.annotation).json !== annotationJson) labelFailure('LABEL_STORED_DATA');
      const targets = item.annotation.kind === 'classification' ? ['classification']
        : item.annotation.rectangles.filter((r) => r.classId === sourceId).map((r) => r.id);
      const annotation: Annotation = item.annotation.kind === 'classification' ? { ...item.annotation, classId: targetId }
        : { ...item.annotation, rectangles: item.annotation.rectangles.map((r) => r.classId === sourceId ? { ...r, classId: targetId } : r) };
      const encoded = encodeCanonicalAnnotation(annotation);
      const updatedAt = new Date(Math.max(Date.parse(at), Date.parse(item.updatedAt) + 1)).toISOString();
      // Unconfirm BEFORE provenance writes; a content mutation increments once.
      const result = this.database.prepare(`UPDATE annotation_items SET annotation_json=?,annotation_sha256=?,
        state=CASE WHEN state='excluded' THEN 'excluded' ELSE 'editing' END,confirmed_at=NULL,negative_confirmed=0,
        edit_version=edit_version+1,updated_at=? WHERE id=? AND workspace_id=? AND edit_version=?`)
        .run(encoded.json, encoded.sha256, updatedAt, item.id, item.workspaceId, item.editVersion);
      if (result.changes !== 1) labelFailure('LABEL_CONFLICT');
      for (const target of targets) this.mergeProvenance(item.id, target, sourceId, targetId);
      workspaces.set(item.workspaceId, { version: workspaceVersion, updatedAt: workspaceUpdatedAt });
    }
    for (const [id, previous] of workspaces) {
      const updatedAt = new Date(Math.max(Date.parse(at), Date.parse(previous.updatedAt) + 1)).toISOString();
      const result = this.database.prepare(`UPDATE annotation_workspaces SET edit_version=edit_version+1,updated_at=?
        WHERE id=? AND project_id=? AND schema_id=? AND state='editing' AND edit_version=?`)
        .run(updatedAt, id, snapshot.projectId, snapshot.id, previous.version);
      if (result.changes !== 1) labelFailure('LABEL_CONFLICT');
    }
  }

  private mergeProvenance(itemId: string, targetKey: string, sourceId: string, targetId: string): void {
    const row = this.database.prepare(`SELECT item_id AS itemId,target_key AS targetKey,kind,
      source_import_id AS sourceImportId,source_image_key AS sourceImageKey,source_annotation_key AS sourceAnnotationKey,
      source_suggestion_id AS sourceSuggestionId,original_json AS originalJson,changes_json AS changesJson
      FROM annotation_provenance WHERE item_id=? AND target_key=?`).get(itemId, targetKey) as
      (Record<string, unknown> & { originalJson: string; changesJson: string }) | undefined;
    let previous: AnnotationProvenance;
    if (row) {
      const { originalJson, changesJson, ...fields } = row;
      previous = annotationProvenanceSchema.parse({ ...fields, original: storedJson(originalJson, MAX_ANNOTATION_JSON_BYTES),
        changes: storedJson(changesJson, MAX_ANNOTATION_JSON_BYTES) });
      if (canonicalProvenanceJson(previous.original) !== originalJson
        || canonicalProvenanceJson(previous.changes) !== changesJson) labelFailure('LABEL_STORED_DATA');
    } else {
      // An unlabeled-provenance draft is legal. Record this explicit manual edit,
      // without inventing import/model origins or human confirmation.
      previous = { itemId, targetKey, kind: 'manual', sourceImportId: null, sourceImageKey: null,
        sourceAnnotationKey: null, sourceSuggestionId: null, original: {}, changes: {} };
    }
    if (previous.kind.startsWith('model-')) labelFailure('LABEL_STORED_DATA');
    const prior = previous.changes['classId'];
    const delta = prior !== null && typeof prior === 'object' && !Array.isArray(prior)
      ? { ...prior, from: prior['from'] ?? sourceId, to: targetId } : { from: sourceId, to: targetId };
    const next = annotationProvenanceSchema.parse({ ...previous,
      kind: previous.kind === 'import-unmodified' ? 'import-edited' : previous.kind,
      changes: { ...previous.changes, classId: delta } });
    if (row) {
      this.database.prepare('UPDATE annotation_provenance SET kind=?,changes_json=? WHERE item_id=? AND target_key=?')
        .run(next.kind, canonicalProvenanceJson(next.changes), itemId, targetKey);
    } else {
      this.database.prepare(`INSERT INTO annotation_provenance(item_id,target_key,kind,changes_json)
        VALUES (?,?,'manual',?)`).run(itemId, targetKey, canonicalProvenanceJson(next.changes));
    }
  }
}