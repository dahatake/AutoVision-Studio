import { z } from 'zod';

const inventoryLimit = 96 * 1024 * 1024;
const sha256Schema = z.string().length(64).regex(/^[0-9a-f]{64}$/);
const labels = ['angular_leaf_spot', 'bean_rust', 'healthy'] as const;
const fileMetadata = {
  byteSize: z.number().int().positive().max(inventoryLimit),
  sha256: sha256Schema,
};
const commonFields = {
  schemaVersion: z.literal(1),
  sampleVersion: z.literal(1),
  sourceSplit: z.literal('train'),
};

// Source URLs are provenance only: parsing performs no fetching or filesystem IO.
export const sampleManifestSchema = z.discriminatedUnion('id', [
  z.strictObject({
    ...commonFields,
    id: z.literal('beans'),
    taskType: z.literal('classification'),
    source: z.strictObject({
      dataset: z.literal('Beans'),
      version: z.literal('27aa014ce09b193e1a6f58112d4a66e0eddb69c5'),
      url: z.literal('https://huggingface.co/datasets/AI-Lab-Makerere/beans/resolve/27aa014ce09b193e1a6f58112d4a66e0eddb69c5/data/train.zip'),
      byteSize: z.literal(143812152),
      sha256: z.literal('284fe8456ce20687f4367ae7ad94a64577e7f9fde2c2c6b1c74340ab5dc82715'),
    }),
    licenses: z.strictObject({ images: z.literal('MIT'), annotations: z.literal('MIT') }),
    images: z.array(z.strictObject({
      // Absolute-end assertions reject trailing newlines as well as unsafe paths.
      path: z.string().regex(/^images\/(angular_leaf_spot|bean_rust|healthy)\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.jpg(?![\s\S])/),
      sourceId: z.string().regex(/^train\/(angular_leaf_spot|bean_rust|healthy)\/[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*\.jpg(?![\s\S])/),
      ...fileMetadata,
      label: z.enum(labels),
    })).length(60),
    files: z.array(z.strictObject({
      path: z.enum(['LICENSE.txt', 'ATTRIBUTION.txt']),
      ...fileMetadata,
    })).length(2),
  }),
  z.strictObject({
    ...commonFields,
    id: z.literal('gwhd-2021'),
    taskType: z.literal('detection'),
    source: z.strictObject({
      dataset: z.literal('Global Wheat Head Dataset 2021'),
      version: z.literal('1.0'),
      url: z.literal('https://zenodo.org/api/records/5092309/files/gwhd_2021.zip/container/gwhd_2021/competition_train.csv'),
      // Declared CSV metadata, not a claim of locally measured source bytes.
      byteSize: z.literal(2841482),
      sha256: sha256Schema,
    }),
    licenses: z.strictObject({
      images: z.literal('CC-BY-4.0'),
      annotations: z.literal('CC-BY-4.0'),
    }),
    images: z.array(z.strictObject({
      path: z.string().regex(/^images\/[0-9a-f]{64}\.(?:jpg|png)(?![\s\S])/),
      sourceId: sha256Schema,
      sourceFilename: z.string().regex(/^[0-9a-f]{64}\.png(?![\s\S])/),
      detectedFormat: z.enum(['jpeg', 'png']),
      ...fileMetadata,
      domain: z.string().min(1).max(128).refine(
        (value) => value.trim().length > 0 && ![...value].some(
          (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
        ),
      ),
    })).length(20),
    files: z.array(z.strictObject({
      path: z.enum(['LICENSE.txt', 'ATTRIBUTION.txt', 'annotations.coco.json']),
      ...fileMetadata,
    })).length(3),
  }),
]).superRefine((manifest, ctx) => {
  const seenImages = {
    path: new Set<string>(),
    sourceId: new Set<string>(),
    sha256: new Set<string>(),
  };
  let inventoryBytes = 0;
  for (const [index, image] of manifest.images.entries()) {
    inventoryBytes += image.byteSize;
    for (const key of ['path', 'sourceId', 'sha256'] as const) {
      const value = image[key].toLowerCase();
      if (seenImages[key].has(value)) {
        ctx.addIssue({
          code: 'custom', path: ['images', index, key],
          message: `Duplicate image ${key} (case-insensitive).`,
        });
      }
      seenImages[key].add(value);
    }
  }
  const seenFiles = new Set<string>();
  for (const [index, file] of manifest.files.entries()) {
    inventoryBytes += file.byteSize;
    const path = file.path.toLowerCase();
    if (seenFiles.has(path)) {
      ctx.addIssue({
        code: 'custom', path: ['files', index, 'path'],
        message: 'Duplicate inventory file path (case-insensitive).',
      });
    }
    seenFiles.add(path);
  }
  // Only this manifest's images + files; the manifest itself is not inventoried.
  // Combined datasets, manifest bytes and cumulative downloads need external verification.
  if (inventoryBytes > inventoryLimit) {
    ctx.addIssue({ code: 'custom', path: [], message: 'Inventory exceeds 96 MiB.' });
  }
  if (manifest.id === 'beans') {
    for (const label of labels) {
      if (manifest.images.filter((image) => image.label === label).length !== 20) {
        ctx.addIssue({
          code: 'custom', path: ['images'],
          message: `Beans requires exactly 20 images for ${label}.`,
        });
      }
    }
    for (const [index, image] of manifest.images.entries()) {
      const basename = image.path.slice(image.path.lastIndexOf('/') + 1);
      if (image.path !== `images/${image.label}/${basename}`) {
        ctx.addIssue({
          code: 'custom', path: ['images', index, 'path'],
          message: 'Beans image path must match its label.',
        });
      }
      if (image.sourceId !== `train/${image.label}/${basename}`) {
        ctx.addIssue({
          code: 'custom', path: ['images', index, 'sourceId'],
          message: 'Beans source ID must match its label and original basename.',
        });
      }
      if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(basename)) {
        ctx.addIssue({
          code: 'custom', path: ['images', index, 'path'],
          message: 'Windows device names are not asset filenames.',
        });
      }
    }
  } else {
    for (const [index, image] of manifest.images.entries()) {
      const extension = image.detectedFormat === 'jpeg' ? 'jpg' : 'png';
      if (image.path !== `images/${image.sourceId}.${extension}`) {
        ctx.addIssue({
          code: 'custom', path: ['images', index, 'path'],
          message: 'GWHD image filename must match its source ID and detected format.',
        });
      }
      if (image.sourceFilename !== `${image.sourceId}.png`) {
        ctx.addIssue({
          code: 'custom', path: ['images', index, 'sourceFilename'],
          message: 'GWHD source filename must preserve the original CSV name.',
        });
      }
    }
  }
});

export type SampleManifest = z.infer<typeof sampleManifestSchema>;