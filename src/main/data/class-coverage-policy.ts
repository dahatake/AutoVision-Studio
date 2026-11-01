// FR-CVP-001 / FR-CVP-008: versioned input-guard policy. Pure functions only.

export const CLASS_COVERAGE_POLICY_VERSION = 1 as const;

/** FR-CVP-001 thresholds (policy version 1). */
export const CLASS_COVERAGE_POLICY = Object.freeze({
  version: CLASS_COVERAGE_POLICY_VERSION,
  minImages: Object.freeze({ classification: 5, detection: 15 }),
  recommendedImages: 50,
  imbalanceRatio: 2,
});

/** FR-CVP-008 per-image limits (policy version 1). Boundary values are accepted. */
export const IMAGE_INPUT_POLICY = Object.freeze({
  version: CLASS_COVERAGE_POLICY_VERSION,
  maxFileBytes: 134_217_728,
  minWidth: 32,
  minHeight: 32,
  maxWidth: 8000,
  maxHeight: 8000,
});

export type CoverageTaskType = 'classification' | 'detection';

export interface CoverageError {
  readonly code: 'CLASS_BELOW_MINIMUM';
  readonly classId: string;
  readonly actual: number;
  readonly required: number;
  readonly shortfall: number;
}

export interface CoverageWarning {
  readonly code: 'CLASS_BELOW_RECOMMENDED' | 'CLASS_IMBALANCE';
  readonly classId: string | null;
  readonly actual: number;
  readonly required: number;
}

export interface CoverageAssessment {
  readonly policyVersion: number;
  readonly errors: readonly CoverageError[];
  readonly warnings: readonly CoverageWarning[];
}

/** Counts per class are confirmed images (classification) or images with that class's annotation (detection). */
export function assessClassCoverage(taskType: CoverageTaskType, classCounts: ReadonlyMap<string, number>): CoverageAssessment {
  const min = CLASS_COVERAGE_POLICY.minImages[taskType];
  const errors: CoverageError[] = [];
  const warnings: CoverageWarning[] = [];
  const entries = [...classCounts].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  for (const [classId, actual] of entries) {
    if (actual < min) errors.push({ code: 'CLASS_BELOW_MINIMUM', classId, actual, required: min, shortfall: min - actual });
  }
  if (errors.length === 0 && entries.length > 0) {
    for (const [classId, actual] of entries) {
      if (actual < CLASS_COVERAGE_POLICY.recommendedImages) {
        warnings.push({ code: 'CLASS_BELOW_RECOMMENDED', classId, actual, required: CLASS_COVERAGE_POLICY.recommendedImages });
      }
    }
    const counts = entries.map(([, count]) => count);
    const smallest = Math.min(...counts), largest = Math.max(...counts);
    if (largest >= smallest * CLASS_COVERAGE_POLICY.imbalanceRatio) {
      warnings.push({ code: 'CLASS_IMBALANCE', classId: null, actual: largest / smallest, required: CLASS_COVERAGE_POLICY.imbalanceRatio });
    }
  }
  return Object.freeze({ policyVersion: CLASS_COVERAGE_POLICY_VERSION, errors, warnings });
}

export interface ImageLimitViolation {
  readonly code: 'FILE_TOO_LARGE' | 'WIDTH_TOO_SMALL' | 'HEIGHT_TOO_SMALL' | 'WIDTH_TOO_LARGE' | 'HEIGHT_TOO_LARGE';
  readonly actual: number;
  readonly limit: number;
}

/** FR-CVP-008: returns violations (empty = accepted). Exactly-at-limit values are accepted. */
export function checkImageInputLimits(image: { readonly byteSize: number; readonly width: number; readonly height: number }): readonly ImageLimitViolation[] {
  const p = IMAGE_INPUT_POLICY, out: ImageLimitViolation[] = [];
  if (image.byteSize > p.maxFileBytes) out.push({ code: 'FILE_TOO_LARGE', actual: image.byteSize, limit: p.maxFileBytes });
  if (image.width < p.minWidth) out.push({ code: 'WIDTH_TOO_SMALL', actual: image.width, limit: p.minWidth });
  if (image.height < p.minHeight) out.push({ code: 'HEIGHT_TOO_SMALL', actual: image.height, limit: p.minHeight });
  if (image.width > p.maxWidth) out.push({ code: 'WIDTH_TOO_LARGE', actual: image.width, limit: p.maxWidth });
  if (image.height > p.maxHeight) out.push({ code: 'HEIGHT_TOO_LARGE', actual: image.height, limit: p.maxHeight });
  return out;
}

interface ManifestLike {
  readonly taskType: CoverageTaskType;
  readonly schema: unknown;
  readonly items: readonly { readonly disposition: string; readonly imageSha256: string; readonly annotation: unknown }[];
}

/** Derive per-class image counts from a revision manifest. `negative`/excluded items count for no class. */
export function countManifestClassImages(manifest: ManifestLike): Map<string, number> {
  const sets = new Map<string, Set<string>>();
  const classes = (manifest.schema as { classes?: unknown } | null)?.classes;
  if (Array.isArray(classes)) {
    for (const entry of classes) {
      const id = (entry as { id?: unknown } | null)?.id;
      if (typeof id === 'string') sets.set(id, new Set());
    }
  }
  for (const item of manifest.items) {
    if (item.disposition !== 'labeled') continue;
    const annotation = item.annotation as { classId?: unknown; rectangles?: unknown } | null;
    const ids: string[] = [];
    if (manifest.taskType === 'classification') {
      if (typeof annotation?.classId === 'string') ids.push(annotation.classId);
    } else if (Array.isArray(annotation?.rectangles)) {
      for (const rect of annotation.rectangles) {
        const id = (rect as { classId?: unknown } | null)?.classId;
        if (typeof id === 'string') ids.push(id);
      }
    }
    for (const id of ids) {
      const set = sets.get(id);
      if (set) set.add(item.imageSha256); else sets.set(id, new Set([item.imageSha256]));
    }
  }
  return new Map([...sets].map(([id, set]) => [id, set.size]));
}
