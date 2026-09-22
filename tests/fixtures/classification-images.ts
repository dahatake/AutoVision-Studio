import { deflateSync } from 'node:zlib';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The scan worker decodes every candidate with Pillow and rejects broken CRCs,
 * so fixtures must be real PNG bytes rather than placeholders.
 */
const crcTable = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1) {
      value = value & 1 ? 0xed_b8_83_20 ^ (value >>> 1) : value >>> 1;
    }
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Buffer): number {
  let value = 0xff_ff_ff_ff;
  for (const byte of bytes) {
    value = (crcTable[(value ^ byte) & 0xff] as number) ^ (value >>> 8);
  }
  return (value ^ 0xff_ff_ff_ff) >>> 0;
}

function chunk(type: string, payload: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(payload.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), payload]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, checksum]);
}

export interface Rgb {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
}

/** Encodes an 8-bit truecolour PNG of a single flat colour. */
export function encodePng(width: number, height: number, colour: Rgb): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.writeUInt8(8, 8); // bit depth
  header.writeUInt8(2, 9); // colour type: truecolour
  const raw = Buffer.alloc(height * (1 + width * 3));
  for (let row = 0; row < height; row += 1) {
    const offset = row * (1 + width * 3);
    raw.writeUInt8(0, offset); // filter: none
    for (let column = 0; column < width; column += 1) {
      const pixel = offset + 1 + column * 3;
      raw.writeUInt8(colour.red, pixel);
      raw.writeUInt8(colour.green, pixel + 1);
      raw.writeUInt8(colour.blue, pixel + 2);
    }
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export function writePng(path: string, width: number, height: number, colour: Rgb): void {
  writeFileSync(path, encodePng(width, height, colour));
}

/** Byte-level garbage behind a `.png` name: the scan must report, not silently drop. */
export function writeCorruptPng(path: string): void {
  writeFileSync(path, Buffer.from('89504e470d0a1a0a-not-a-real-png', 'utf8'));
}

export function createFixtureRoot(label: string): string {
  const root = join(tmpdir(), 'autovision-e2e-data');
  mkdirSync(root, { recursive: true });
  return mkdtempSync(join(root, `${label}-`));
}

export const classificationClasses = ['blue', 'green'] as const;
export type ClassificationClass = (typeof classificationClasses)[number];

const palette: Record<ClassificationClass, Rgb> = {
  blue: { red: 16, green: 32, blue: 224 },
  green: { red: 24, green: 208, blue: 64 },
};

export interface ClassificationDataset {
  readonly root: string;
  /** Image count the scan preview is expected to report. */
  readonly imageCount: number;
}

/** `root/<class>/<n>.png` — the folder layout FR-DAT-005 labels by first directory. */
export function createClassFolderDataset(perClass = 2): ClassificationDataset {
  const root = createFixtureRoot('folder');
  for (const name of classificationClasses) {
    const directory = join(root, name);
    mkdirSync(directory, { recursive: true });
    for (let index = 0; index < perClass; index += 1) {
      writePng(join(directory, `${name}-${index}.png`), 32 + index, 24 + index, palette[name]);
    }
  }
  return { root, imageCount: classificationClasses.length * perClass };
}

/** `path,label` UTF-8 CSV with root-relative paths, as FR-DAT-005 specifies exactly. */
export function createCsvDataset(perClass = 2): ClassificationDataset & { readonly csvPath: string } {
  const root = createFixtureRoot('csv');
  const images = join(root, 'images');
  mkdirSync(images, { recursive: true });
  const rows: string[] = ['path,label'];
  for (const name of classificationClasses) {
    for (let index = 0; index < perClass; index += 1) {
      const relative = `images/${name}-${index}.png`;
      writePng(join(root, relative), 32 + index, 24 + index, palette[name]);
      rows.push(`${relative},${name}`);
    }
  }
  const csvPath = join(root, 'labels.csv');
  writeFileSync(csvPath, `${rows.join('\n')}\n`, 'utf8');
  return { root, csvPath, imageCount: classificationClasses.length * perClass };
}

/** Flat folder of unlabeled images: every item must arrive as 未着手. */
export function createUnlabeledDataset(count = 3): ClassificationDataset {
  const root = createFixtureRoot('unlabeled');
  for (let index = 0; index < count; index += 1) {
    writePng(join(root, `image-${index}.png`), 32 + index, 24 + index, palette.blue);
  }
  return { root, imageCount: count };
}

/** Valid images plus one corrupt file, to prove the scan reports instead of dropping. */
export function createDatasetWithCorruptFile(): ClassificationDataset & { readonly corruptPath: string } {
  const root = createFixtureRoot('corrupt');
  for (const name of classificationClasses) {
    const directory = join(root, name);
    mkdirSync(directory, { recursive: true });
    writePng(join(directory, `${name}-0.png`), 32, 24, palette[name]);
  }
  const corruptPath = join(root, `${classificationClasses[0]}`, 'broken.png');
  writeCorruptPng(corruptPath);
  return { root, corruptPath, imageCount: classificationClasses.length };
}
