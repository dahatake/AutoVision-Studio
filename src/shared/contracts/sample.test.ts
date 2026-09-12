import { describe, expect, it } from 'vitest';

import { sampleManifestSchema, type SampleManifest } from './sample.js';

// Synthetic metadata only: constructed hashes/IDs are not real assets or digest evidence.
const hex = (value: number) => value.toString(16).padStart(64, '0');
function fixture(id: SampleManifest['id']): SampleManifest {
  const common = { schemaVersion: 1, sampleVersion: 1, sourceSplit: 'train' } as const;
  const files = [
    { path: 'LICENSE.txt' as const, byteSize: 10, sha256: hex(901) },
    { path: 'ATTRIBUTION.txt' as const, byteSize: 20, sha256: hex(902) },
  ];
  if (id === 'beans') {
    return {
      ...common, id, taskType: 'classification',
      source: {
        dataset: 'Beans', version: '27aa014ce09b193e1a6f58112d4a66e0eddb69c5',
        url: 'https://huggingface.co/datasets/AI-Lab-Makerere/beans/resolve/27aa014ce09b193e1a6f58112d4a66e0eddb69c5/data/train.zip',
        byteSize: 143812152, sha256: '284fe8456ce20687f4367ae7ad94a64577e7f9fde2c2c6b1c74340ab5dc82715',
      },
      licenses: { images: 'MIT', annotations: 'MIT' }, files,
      images: Array.from({ length: 60 }, (_, index) => {
        const label = (['angular_leaf_spot', 'bean_rust', 'healthy'] as const)[Math.floor(index / 20)];
        return {
          path: `images/${label}/fixture-${index}.jpg`, sourceId: `train/${label}/fixture-${index}.jpg`,
          byteSize: 1000, sha256: hex(index + 1), label,
        };
      }),
    };
  }
  return {
    ...common, id, taskType: 'detection',
    source: {
      dataset: 'Global Wheat Head Dataset 2021', version: '1.0',
      url: 'https://zenodo.org/api/records/5092309/files/gwhd_2021.zip/container/gwhd_2021/competition_train.csv',
      byteSize: 2841482, sha256: hex(9000),
    },
    licenses: { images: 'CC-BY-4.0', annotations: 'CC-BY-4.0' },
    images: Array.from({ length: 20 }, (_, index) => ({
      path: `images/${hex(1000 + index)}.jpg`, sourceId: hex(1000 + index),
      sourceFilename: `${hex(1000 + index)}.png`, detectedFormat: 'jpeg' as const,
      byteSize: 1000, sha256: hex(index + 1), domain: 'Arvalis_1',
    })),
    files: [...files, { path: 'annotations.coco.json', byteSize: 30, sha256: hex(903) }],
  };
}

describe.each(['beans', 'gwhd-2021'] as const)('sampleManifestSchema (%s)', (id) => {
  it('accepts fixed metadata and reordered inventory', () => {
    const manifest = fixture(id);
    expect(sampleManifestSchema.parse(manifest)).toEqual(manifest);
    expect(sampleManifestSchema.safeParse({ ...manifest, files: [...manifest.files].reverse() }).success).toBe(true);
  });

  it('rejects unknown identity, versions, split and task', () => {
    const manifest = fixture(id);
    for (const patch of [
      { id: 'other' }, { id: id.toUpperCase() }, { schemaVersion: 2 }, { schemaVersion: '1' },
      { sampleVersion: 2 }, { sampleVersion: '1' }, { sourceSplit: 'test' }, { sourceSplit: 'validation' },
      { taskType: 'other' }, { taskType: id === 'beans' ? 'detection' : 'classification' },
    ]) expect(sampleManifestSchema.safeParse({ ...manifest, ...patch }).success).toBe(false);
  });

  it('rejects changed source metadata and malformed source hashes', () => {
    const manifest = fixture(id);
    for (const patch of [
      { dataset: 'other' }, { version: 'main' }, { byteSize: manifest.source.byteSize + 1 },
      { url: manifest.source.url.replace('https:', 'http:') }, { url: `${manifest.source.url}?download=1` },
      { sha256: 'A'.repeat(64) }, { sha256: 'g'.repeat(64) }, { sha256: '0'.repeat(63) },
    ]) expect(sampleManifestSchema.safeParse({ ...manifest, source: { ...manifest.source, ...patch } }).success).toBe(false);
  });

  it('rejects incorrect image or annotation licenses', () => {
    const manifest = fixture(id);
    for (const key of ['images', 'annotations']) {
      for (const value of ['unknown', 'mit', id === 'beans' ? 'CC-BY-4.0' : 'MIT']) {
        expect(sampleManifestSchema.safeParse({ ...manifest, licenses: { ...manifest.licenses, [key]: value } }).success).toBe(false);
      }
    }
  });

  it('rejects unknown fields at every object level', () => {
    const manifest = fixture(id);
    for (const patch of [
      { confirmed: true }, { modelWeights: [] },
      { source: { ...manifest.source, confirmed: true } },
      { licenses: { ...manifest.licenses, confirmed: true } },
      { images: [{ ...manifest.images[0], confirmed: true }, ...manifest.images.slice(1)] },
      { images: [{ ...manifest.images[0], width: 1024 }, ...manifest.images.slice(1)] },
      { images: [{ ...manifest.images[0], ...(id === 'beans' ? { domain: 19 } : { label: 'healthy' }) }, ...manifest.images.slice(1)] },
      { files: [{ ...manifest.files[0], confirmed: true }, ...manifest.files.slice(1)] },
    ]) expect(sampleManifestSchema.safeParse({ ...manifest, ...patch }).success).toBe(false);
  });

  it('rejects too few or too many images', () => {
    const manifest = fixture(id);
    const extra = id === 'beans'
      ? { ...manifest.images[0], path: 'images/angular_leaf_spot/extra.jpg', sourceId: 'train/angular_leaf_spot/extra.jpg', sha256: hex(999) }
      : { ...manifest.images[0], path: `images/${hex(999)}.jpg`, sourceId: hex(999), sourceFilename: `${hex(999)}.png`, sha256: hex(999) };
    for (const images of [[], manifest.images.slice(1), [...manifest.images, extra]]) {
      expect(sampleManifestSchema.safeParse({ ...manifest, images }).success).toBe(false);
    }
  });

  it('requires exact unique inventory paths without case variants or a self entry', () => {
    const manifest = fixture(id);
    for (const files of [
      [], [...manifest.files, manifest.files[0]],
      ...manifest.files.map((_, index) => manifest.files.filter((__, position) => position !== index)),
      [manifest.files[0], manifest.files[0], ...manifest.files.slice(2)],
      ...['license.txt', 'manifest.json', '../LICENSE.txt', 'model.onnx'].map((path) => [
        { ...manifest.files[0], path }, ...manifest.files.slice(1),
      ]),
    ]) expect(sampleManifestSchema.safeParse({ ...manifest, files }).success).toBe(false);
  });

  it('rejects absolute, traversal, ADS, backslash, NUL, encoded and non-ASCII paths', () => {
    const manifest = fixture(id);
    for (const key of ['path', 'sourceId'] as const) {
      const value = manifest.images[0][key];
      for (const invalid of [
        `/${value}`, `C:/${value}`, `../${value}`, `${value}:stream`, value.replaceAll('/', '\\'),
        `${value}\0`, `%2e%2e/${value}`, value.replace('images', '%69mages'), `${value}\n`,
        `${value}\r`, `画像/${value}`, value.toUpperCase(),
      ].filter((candidate) => candidate !== value)) {
        const images = [{ ...manifest.images[0], [key]: invalid }, ...manifest.images.slice(1)];
        expect(sampleManifestSchema.safeParse({ ...manifest, images }).success).toBe(false);
      }
    }
  });

  it('rejects malformed image and inventory hashes', () => {
    const manifest = fixture(id);
    for (const sha256 of ['A'.repeat(64), 'g'.repeat(64), '0'.repeat(63), '0'.repeat(65), `${hex(1)}\n`, null, 1]) {
      for (const key of ['images', 'files'] as const) {
        const entries = [{ ...manifest[key][0], sha256 }, ...manifest[key].slice(1)];
        expect(sampleManifestSchema.safeParse({ ...manifest, [key]: entries }).success).toBe(false);
      }
    }
  });

  it('reports duplicate image paths, source IDs and binary hashes at the offending field', () => {
    const manifest = fixture(id);
    for (const key of ['path', 'sourceId', 'sha256'] as const) {
      const images = [manifest.images[0], { ...manifest.images[1], [key]: manifest.images[0][key] }, ...manifest.images.slice(2)];
      const result = sampleManifestSchema.safeParse({ ...manifest, images });
      expect(result.success).toBe(false);
      expect(result.error?.issues).toContainEqual(expect.objectContaining({ code: 'custom', path: ['images', 1, key] }));
    }
  });

  it('rejects nonpositive, nonfinite, fractional and unsafe byte sizes', () => {
    const manifest = fixture(id);
    for (const byteSize of [0, -1, 0.5, NaN, Infinity, -Infinity, Number.MAX_SAFE_INTEGER + 1, 256 * 1024 * 1024 + 1, '1', null]) {
      expect(sampleManifestSchema.safeParse({ ...manifest, source: { ...manifest.source, byteSize } }).success).toBe(false);
      for (const key of ['images', 'files'] as const) {
        const entries = [{ ...manifest[key][0], byteSize }, ...manifest[key].slice(1)];
        expect(sampleManifestSchema.safeParse({ ...manifest, [key]: entries }).success).toBe(false);
      }
    }
  });

  it('enforces the per-manifest image-plus-file budget at exactly 96 MiB', () => {
    const manifest = fixture(id);
    const otherBytes = [...manifest.images.slice(1), ...manifest.files].reduce((sum, file) => sum + file.byteSize, 0);
    manifest.images[0].byteSize = 96 * 1024 * 1024 - otherBytes;
    expect(sampleManifestSchema.safeParse(manifest).success).toBe(true);
    manifest.files[0].byteSize += 1;
    const result = sampleManifestSchema.safeParse(manifest);
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(expect.objectContaining({ code: 'custom', path: [], message: 'Inventory exceeds 96 MiB.' }));
  });
});

describe('sample-specific invariants', () => {
  it('pins the Beans source hash even when a replacement is valid lowercase hex', () => {
    const manifest = fixture('beans');
    expect(sampleManifestSchema.safeParse({ ...manifest, source: { ...manifest.source, sha256: hex(1) } }).success).toBe(false);
  });

  it('requires exactly twenty Beans images per label', () => {
    const manifest = fixture('beans');
    const images = [{ ...manifest.images[0], label: 'bean_rust', path: 'images/bean_rust/fixture-0.jpg', sourceId: 'train/bean_rust/fixture-0.jpg' }, ...manifest.images.slice(1)];
    const result = sampleManifestSchema.safeParse({ ...manifest, images });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(expect.objectContaining({ code: 'custom', path: ['images'] }));
  });

  it('rejects Beans label, directory, basename and Windows-device mismatches', () => {
    const manifest = fixture('beans');
    for (const patch of [
      { label: 'unknown' }, { label: 'healthy' }, { path: 'images/healthy/fixture-0.jpg' },
      { sourceId: 'train/healthy/fixture-0.jpg' }, { sourceId: 'train/angular_leaf_spot/different.jpg' },
      ...['../outside', 'a..b', 'a:b', 'a\\b', '%2e%2e', 'leaf\0', 'leaf\n', '葉', 'CON', 'nul.log'].map((name) => ({
        path: `images/angular_leaf_spot/${name}.jpg`, sourceId: `train/angular_leaf_spot/${name}.jpg`,
      })),
    ]) expect(sampleManifestSchema.safeParse({ ...manifest, images: [{ ...manifest.images[0], ...patch }, ...manifest.images.slice(1)] }).success).toBe(false);
  });

  it('rejects case-folded Beans basename aliases', () => {
    const manifest = fixture('beans');
    const images = [manifest.images[0], { ...manifest.images[1], path: 'images/angular_leaf_spot/FIXTURE-0.jpg', sourceId: 'train/angular_leaf_spot/FIXTURE-0.jpg' }, ...manifest.images.slice(2)];
    const result = sampleManifestSchema.safeParse({ ...manifest, images });
    expect(result.success).toBe(false);
    expect(result.error?.issues).toContainEqual(expect.objectContaining({ code: 'custom', path: ['images', 1, 'path'] }));
  });

  it('requires a GWHD filename to match its 64-hex source ID', () => {
    const manifest = fixture('gwhd-2021');
    for (const patch of [
      { sourceId: hex(8000) },
      { sourceId: `${hex(1000)}.png` },
      { path: `images/${hex(8000)}.jpg` },
      { path: `images/${hex(1000)}.png` },
      { sourceFilename: `${hex(8000)}.png` },
      { sourceFilename: `${hex(1000)}.jpg` },
      { detectedFormat: 'png' },
      { detectedFormat: 'webp' },
    ]) {
      expect(sampleManifestSchema.safeParse({ ...manifest, images: [{ ...manifest.images[0], ...patch }, ...manifest.images.slice(1)] }).success).toBe(false);
    }
  });

  it('accepts raw PNG or JPEG bytes when provenance and published extension agree', () => {
    const manifest = fixture('gwhd-2021');
    expect(sampleManifestSchema.safeParse(manifest).success).toBe(true);
    const png = {
      ...manifest.images[0],
      path: `images/${manifest.images[0].sourceId}.png`,
      detectedFormat: 'png' as const,
    };
    expect(sampleManifestSchema.safeParse({
      ...manifest,
      images: [png, ...manifest.images.slice(1)],
    }).success).toBe(true);
  });

  it('preserves GWHD source domain names as strings', () => {
    const manifest = fixture('gwhd-2021');
    for (const domain of ['Arvalis_1', 'ETHZ_1', 'ULiège-GxABT_1']) {
      expect(sampleManifestSchema.safeParse({ ...manifest, images: [{ ...manifest.images[0], domain }, ...manifest.images.slice(1)] }).success).toBe(true);
    }
  });

  it('rejects non-string, empty and malformed GWHD domain names', () => {
    const manifest = fixture('gwhd-2021');
    for (const domain of [0, -1, 0.5, NaN, Infinity, null, '', ' ', 'Arvalis_1\n', 'ULiège\0', 'x'.repeat(129)]) {
      expect(sampleManifestSchema.safeParse({ ...manifest, images: [{ ...manifest.images[0], domain }, ...manifest.images.slice(1)] }).success).toBe(false);
    }
  });
});