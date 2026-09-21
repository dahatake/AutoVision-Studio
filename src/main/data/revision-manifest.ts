import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { annotationIdSchema } from '../../shared/contracts/annotation.js';
import type { DatabaseConnection } from '../db/database.js';
import { validateAnnotationWorkspace } from '../annotations/validate-annotation.js';

export interface RevisionManifestItem {
  readonly sourceItemId: string;
  readonly importId: string;
  readonly imageKey: string;
  readonly imageSha256: string;
  readonly width: number;
  readonly height: number;
  readonly disposition: 'labeled' | 'negative' | 'excluded';
  readonly split: 'train' | 'validation' | 'test' | null;
  readonly annotationJson: string;
  readonly provenanceJson: string;
  readonly sourceSnapshotJson: string;
  readonly annotation: unknown;
  readonly provenance: unknown;
  readonly source: unknown;
}

export interface RevisionManifest {
  readonly formatVersion: 1;
  readonly revisionId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly revisionNo: number;
  readonly taskType: 'classification' | 'detection';
  readonly mode: 'copy' | 'reference';
  readonly splitSeed: number;
  readonly itemCount: number;
  readonly createdBy: string;
  readonly confirmedAt: string;
  readonly schema: unknown;
  readonly lineage: readonly string[];
  readonly items: readonly RevisionManifestItem[];
}

export interface RevisionManifestWriteResult {
  readonly manifest: RevisionManifest;
  readonly manifestJson: string;
  readonly manifestSha256: string;
  readonly relativePath: string;
  readonly absolutePath: string;
}

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean'
    || (typeof value === 'number' && Number.isFinite(value))) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (typeof value !== 'object' || value === null) throw new Error('Invalid revision manifest value.');
  return `{${Object.keys(value).sort().map((key) =>
    `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}

function hashText(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function scoreHash(hash: string, seed: number): bigint {
  const digest = createHash('sha256').update(`${seed}:${hash}`, 'utf8').digest();
  return digest.readBigUInt64BE(0);
}

function splitForScore(score: bigint): 'train' | 'validation' | 'test' {
  const bucket = Number(score % 100n);
  if (bucket < 80) return 'train';
  if (bucket < 90) return 'validation';
  return 'test';
}

function splitForHash(hash: string, seed: number): 'train' | 'validation' | 'test' {
  return splitForScore(scoreHash(hash, seed));
}

function parseJson(text: unknown): unknown {
  if (typeof text !== 'string') throw new Error('Stored revision JSON snapshot is invalid.');
  return JSON.parse(text) as unknown;
}

export function buildRevisionManifest(database: DatabaseConnection, input: {
  readonly revisionId: string;
  readonly projectId: string;
  readonly workspaceId: string;
  readonly revisionNo: number;
  readonly splitSeed: number;
  readonly createdBy: string;
  readonly confirmedAt: string;
  readonly lineage: readonly string[];
}): RevisionManifest {
  const revisionId = annotationIdSchema.parse(input.revisionId);
  const projectId = annotationIdSchema.parse(input.projectId);
  const workspaceId = annotationIdSchema.parse(input.workspaceId);
  const validation = validateAnnotationWorkspace(database, projectId, workspaceId);
  const blocking = validation.issues.filter((issue) => issue.code !== 'excluded');
  if (blocking.length !== 0 || validation.confirmed === 0) {
    throw new Error('Revision manifest requires confirmed items and no unconfirmed or invalid candidates.');
  }
  const workspace = database.prepare(`SELECT task_type AS taskType,mode FROM annotation_workspaces
    WHERE id=? AND project_id=?`).get(workspaceId, projectId) as { taskType: 'classification' | 'detection'; mode: 'copy' | 'reference' };
  const schema = database.prepare(`SELECT s.snapshot_json AS snapshotJson FROM annotation_workspaces w
    JOIN annotation_schema_snapshots s ON s.schema_id=w.schema_id WHERE w.id=?`).get(workspaceId) as { snapshotJson: string };
  const rows = database.prepare(`SELECT a.id AS sourceItemId,a.import_id AS importId,a.image_key AS imageKey,
    a.image_sha256 AS imageSha256,a.width,a.height,a.annotation_json AS annotationJson,
    a.negative_confirmed AS negativeConfirmed,a.state,a.exclusion_reason AS exclusionReason,
    p.snapshot_json AS provenanceJson,s.snapshot_json AS sourceJson
    FROM annotation_items a
    JOIN annotation_provenance_snapshots p ON p.item_id=a.id
    JOIN annotation_source_snapshots s ON s.import_id=a.import_id AND s.image_key=a.image_key
    WHERE a.workspace_id=? AND a.state IN ('confirmed','excluded') ORDER BY a.id`).all(workspaceId);
  if (rows.length !== validation.total) throw new Error('Revision manifest has unprocessed candidates.');
  const prepared = rows.map((raw) => {
    const row = raw as Record<string, unknown>;
    const sourceItemId = annotationIdSchema.parse(row.sourceItemId);
    const importId = annotationIdSchema.parse(row.importId);
    const imageKey = String(row.imageKey);
    const imageSha256 = String(row.imageSha256);
    const excluded = row.state === 'excluded';
    const annotation = parseJson(row.annotationJson) as { kind?: unknown; classId?: unknown };
    const disposition: 'labeled' | 'negative' | 'excluded' = excluded
      ? 'excluded' : row.negativeConfirmed === 1 ? 'negative' : 'labeled';
    return {
      sourceItemId,
      importId,
      imageKey,
      imageSha256,
      width: Number(row.width),
      height: Number(row.height),
      disposition,
      annotationJson: String(row.annotationJson),
      provenanceJson: String(row.provenanceJson),
      sourceSnapshotJson: String(row.sourceJson),
      annotation,
      provenance: parseJson(row.provenanceJson),
      source: parseJson(row.sourceJson),
      classId: typeof annotation.classId === 'string' ? annotation.classId : null,
    };
  });
  const splitByHash = new Map<string, 'train' | 'validation' | 'test'>();
  if (workspace.taskType === 'classification') {
    const byClass = new Map<string, string[]>();
    const classByHash = new Map<string, string>();
    for (const item of prepared) {
      if (item.disposition === 'excluded') continue;
      if (item.classId === null) throw new Error('Classification revision item is missing class.');
      const previous = classByHash.get(item.imageSha256);
      if (previous !== undefined && previous !== item.classId) throw new Error('Image hash crosses classification classes.');
      classByHash.set(item.imageSha256, item.classId);
      const hashes = byClass.get(item.classId);
      if (hashes) {
        if (!hashes.includes(item.imageSha256)) hashes.push(item.imageSha256);
      } else byClass.set(item.classId, [item.imageSha256]);
    }
    for (const hashes of byClass.values()) {
      const ordered = [...hashes].sort((left, right) => {
        const leftScore = scoreHash(left, input.splitSeed), rightScore = scoreHash(right, input.splitSeed);
        return leftScore < rightScore ? -1 : leftScore > rightScore ? 1 : left < right ? -1 : left > right ? 1 : 0;
      });
      ordered.forEach((hash, index) => {
        const bucket = Math.floor(index * 100 / ordered.length);
        splitByHash.set(hash, bucket < 80 ? 'train' : bucket < 90 ? 'validation' : 'test');
      });
    }
  } else {
    for (const item of prepared) {
      if (item.disposition !== 'excluded' && !splitByHash.has(item.imageSha256)) {
        splitByHash.set(item.imageSha256, splitForHash(item.imageSha256, input.splitSeed));
      }
    }
  }
  const items = prepared.map(({ classId, ...item }) => Object.freeze({
    ...item,
    split: item.disposition === 'excluded' ? null : splitByHash.get(item.imageSha256)!,
  }));
  return Object.freeze({
    formatVersion: 1,
    revisionId,
    projectId,
    workspaceId,
    revisionNo: input.revisionNo,
    taskType: workspace.taskType,
    mode: workspace.mode,
    splitSeed: input.splitSeed,
    itemCount: items.length,
    createdBy: input.createdBy,
    confirmedAt: input.confirmedAt,
    schema: parseJson(schema.snapshotJson),
    lineage: Object.freeze([...input.lineage]),
    items: Object.freeze(items),
  });
}

export function writeRevisionManifestAtomic(database: DatabaseConnection, projectId: string,
  workspaceId: string, workspaceRoot: string, input: Omit<Parameters<typeof buildRevisionManifest>[1], 'projectId' | 'workspaceId'>): RevisionManifestWriteResult {
  const manifest = buildRevisionManifest(database, { ...input, projectId, workspaceId });
  const manifestJson = stableJson(manifest);
  const manifestSha256 = hashText(manifestJson);
  const relativePath = `datasets/${manifest.revisionId}/manifest.json`;
  const absolutePath = join(workspaceRoot, 'datasets', manifest.revisionId, 'manifest.json');
  const temporaryPath = join(dirname(absolutePath), `.manifest.${randomUUID()}.tmp`);
  mkdirSync(dirname(absolutePath), { recursive: true });
  try {
    writeFileSync(temporaryPath, manifestJson, { encoding: 'utf8', flag: 'wx' });
    const written = readFileSync(temporaryPath, 'utf8');
    if (hashText(written) !== manifestSha256) throw new Error('Revision manifest hash verification failed.');
    renameSync(temporaryPath, absolutePath);
  } catch (error) {
    rmSync(temporaryPath, { force: true });
    throw error;
  }
  return Object.freeze({ manifest, manifestJson, manifestSha256, relativePath, absolutePath });
}

export function removeRevisionManifestFile(path: string): void {
  rmSync(path, { force: true });
  rmSync(dirname(path), { recursive: true, force: true });
}
