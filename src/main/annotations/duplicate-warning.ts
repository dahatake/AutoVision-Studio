import { z } from 'zod';

import { annotationRectangleSchema, type AnnotationRectangle } from '../../shared/contracts/annotation.js';

/** Intersection over union at or above this ratio means two same-class boxes
 * cover the same object closely enough that a reviewer should look. */
export const DUPLICATE_IOU_THRESHOLD = 0.8;
/** Pairwise comparison is quadratic; refuse instead of stalling the main process. */
export const MAX_COMPARED_RECTANGLES = 1_000;

export interface DuplicateWarning {
  readonly classId: string;
  readonly firstId: string;
  readonly secondId: string;
  readonly iou: number;
}

const thresholdSchema = z.number().gt(0).max(1);
const rectanglesSchema = z.array(annotationRectangleSchema).max(MAX_COMPARED_RECTANGLES);

export function intersectionOverUnion(first: AnnotationRectangle, second: AnnotationRectangle): number {
  const width = Math.min(first.x + first.width, second.x + second.width) - Math.max(first.x, second.x);
  const height = Math.min(first.y + first.height, second.y + second.height) - Math.max(first.y, second.y);
  if (width <= 0 || height <= 0) return 0;
  const overlap = width * height;
  const union = first.width * first.height + second.width * second.height - overlap;
  return union <= 0 ? 0 : overlap / union;
}

/** W2-14: report same-class rectangles that overlap heavily. This is advice
 * only — nothing is deleted, merged, reordered or rewritten here, and the
 * caller receives every offending pair so a person decides what to do.
 * Ordering is deterministic (strongest overlap first, then identity) so the
 * same annotation always produces the same warning list. */
export function findDuplicateRectangles(
  rectangles: unknown, threshold: number = DUPLICATE_IOU_THRESHOLD,
): DuplicateWarning[] {
  const limit = thresholdSchema.parse(threshold);
  const parsed = rectanglesSchema.parse(rectangles);
  const warnings: DuplicateWarning[] = [];
  for (let outer = 0; outer < parsed.length; outer += 1) {
    for (let inner = outer + 1; inner < parsed.length; inner += 1) {
      const first = parsed[outer]!, second = parsed[inner]!;
      if (first.classId !== second.classId) continue;
      const iou = intersectionOverUnion(first, second);
      if (iou < limit) continue;
      const [firstId, secondId] = first.id <= second.id ? [first.id, second.id] : [second.id, first.id];
      warnings.push({ classId: first.classId, firstId, secondId, iou });
    }
  }
  return warnings.sort((left, right) => right.iou - left.iou
    || left.firstId.localeCompare(right.firstId) || left.secondId.localeCompare(right.secondId));
}
