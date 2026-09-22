import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createFixtureRoot, writePng } from './classification-images';

export interface CocoDataset {
  readonly root: string;
  readonly annotationPath: string;
  readonly imageCount: number;
  readonly categoryNames: readonly string[];
  /** COCO item ids the scan must report as errors rather than drop. */
  readonly invalidAnnotationIds: readonly string[];
}

interface CocoImage {
  readonly id: number;
  readonly file_name: string;
  readonly width: number;
  readonly height: number;
}

interface CocoAnnotation {
  readonly id: number;
  readonly image_id: number;
  readonly category_id: number;
  readonly bbox: readonly number[];
  readonly iscrowd?: number;
}

const width = 64;
const height = 48;
const categories = [
  { id: 1, name: 'bolt' },
  { id: 2, name: 'nut' },
];

function writeImages(root: string, count: number): CocoImage[] {
  const directory = join(root, 'images');
  mkdirSync(directory, { recursive: true });
  const images: CocoImage[] = [];
  for (let index = 0; index < count; index += 1) {
    const fileName = `images/frame-${index}.png`;
    writePng(join(root, fileName), width, height, { red: 200, green: 64 + index * 20, blue: 32 });
    images.push({ id: index + 1, file_name: fileName, width, height });
  }
  return images;
}

function writeAnnotationFile(
  root: string,
  images: readonly CocoImage[],
  annotations: readonly CocoAnnotation[],
): string {
  const annotationPath = join(root, 'annotations.json');
  writeFileSync(
    annotationPath,
    `${JSON.stringify({ images, annotations, categories }, null, 2)}\n`,
    'utf8',
  );
  return annotationPath;
}

/** A fully valid COCO detection dataset: every box fits inside its image. */
export function createCocoDataset(imageCount = 2): CocoDataset {
  const root = createFixtureRoot('coco');
  const images = writeImages(root, imageCount);
  const annotations = images.map((image, index) => ({
    id: index + 1,
    image_id: image.id,
    category_id: categories[index % categories.length]!.id,
    bbox: [4, 4, 20, 16],
    iscrowd: 0,
  }));
  writeAnnotationFile(root, images, annotations);
  return {
    root,
    annotationPath: join(root, 'annotations.json'),
    imageCount,
    categoryNames: categories.map(({ name }) => name),
    invalidAnnotationIds: [],
  };
}

/**
 * Valid images where the second one carries no annotation at all. The second
 * item must import as 未着手 with zero rectangles so "対象物なし" can be
 * declared explicitly rather than inferred from an empty list.
 */
export function createCocoDatasetWithNegative(): CocoDataset {
  const root = createFixtureRoot('coco-negative');
  const images = writeImages(root, 2);
  const annotations: CocoAnnotation[] = [
    { id: 1, image_id: images[0]!.id, category_id: 1, bbox: [4, 4, 20, 16], iscrowd: 0 },
  ];
  writeAnnotationFile(root, images, annotations);
  return {
    root,
    annotationPath: join(root, 'annotations.json'),
    imageCount: images.length,
    categoryNames: categories.map(({ name }) => name),
    invalidAnnotationIds: [],
  };
}

/**
 * Valid images plus annotations that must each be reported individually:
 * an unknown image id, an unknown category id and an out-of-bounds bbox.
 */
export function createCocoDatasetWithInvalidItems(): CocoDataset {
  const root = createFixtureRoot('coco-invalid');
  const images = writeImages(root, 2);
  const annotations: CocoAnnotation[] = [
    { id: 1, image_id: images[0]!.id, category_id: 1, bbox: [2, 2, 10, 10], iscrowd: 0 },
    { id: 2, image_id: 9_999, category_id: 1, bbox: [1, 1, 5, 5], iscrowd: 0 },
    { id: 3, image_id: images[1]!.id, category_id: 4_242, bbox: [1, 1, 5, 5], iscrowd: 0 },
    { id: 4, image_id: images[1]!.id, category_id: 2, bbox: [0, 0, width * 4, height * 4], iscrowd: 0 },
  ];
  writeAnnotationFile(root, images, annotations);
  return {
    root,
    annotationPath: join(root, 'annotations.json'),
    imageCount: images.length,
    categoryNames: categories.map(({ name }) => name),
    invalidAnnotationIds: ['annotations[1]', 'annotations[2]', 'annotations[3]'],
  };
}
