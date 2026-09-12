import { z } from 'zod';

import { MAX_IMAGE_BYTES, MAX_INPUT_ITEMS } from '../../shared/contracts/import.js';
import type { ProjectFileIdentity } from '../projects/project-directory.js';

function scalar(value: string): boolean {
  return value.isWellFormed() && !value.includes('\0');
}

function safeName(name: string): boolean {
  return name.length > 0 && name.length <= 255 && name !== '.' && name !== '..' && scalar(name)
    && !/[\u0000-\u001f\u007f<>:"/\\|?*]/u.test(name) && !/[ .]$/u.test(name)
    && !/^(?:con|conin\$|conout\$|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/iu.test(name);
}

function projectRelativePath(value: string): boolean {
  if (value.length === 0 || value.length > 32_767 || !scalar(value)
    || value.includes('\\') || value.startsWith('/') || value.endsWith('/')) return false;
  const parts = value.split('/');
  if (parts.some((part) => !safeName(part))) return false;
  const name = parts.at(-1)!;
  return !(parts.length === 1 && name.toUpperCase() === '.AUTOVISION-PROJECT.JSON')
    && !(/^\.autovision-copy-.+\.tmp$/iu.test(name));
}

function localWindowsPath(value: string): boolean {
  if (process.platform !== 'win32' || value.length > 32_767 || !scalar(value)
    || !/^[a-z]:[\\/]/iu.test(value) || value.endsWith('\\') || value.endsWith('/')) return false;
  const path = value.replaceAll('/', '\\');
  const parts = path.slice(3).split('\\');
  return parts.length > 0 && parts.every(safeName);
}

function plainJson(value: unknown, active: Set<object>): boolean {
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'string') return scalar(value);
  if (typeof value === 'number') return Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
  if (typeof value !== 'object' || active.has(value)) return false;
  active.add(value);
  let valid: boolean;
  if (Array.isArray(value)) {
    valid = Reflect.ownKeys(value).length === value.length + 1;
    for (let index = 0; valid && index < value.length; index += 1) {
      const field = Object.getOwnPropertyDescriptor(value, String(index));
      valid = field !== undefined && field.enumerable === true && Object.hasOwn(field, 'value')
        && plainJson(field.value, active);
    }
  } else {
    const prototype: unknown = Object.getPrototypeOf(value);
    valid = (prototype === Object.prototype || prototype === null)
      && Reflect.ownKeys(value).every((key) => {
        const field = Object.getOwnPropertyDescriptor(value, key);
        return typeof key === 'string' && key !== '__proto__' && scalar(key)
          && field !== undefined && field.enumerable === true && Object.hasOwn(field, 'value')
          && plainJson(field.value, active);
      });
  }
  active.delete(value);
  return valid;
}

const jsonObject = z.custom<Record<string, unknown>>((value) => {
  try {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      && plainJson(value, new Set());
  } catch { return false; }
});
const imageKey = z.string().refine((value) => scalar(value) &&
  /[^\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff]/u.test(value));
const byteSize = z.number().int().min(1).max(MAX_IMAGE_BYTES);
const sha256 = z.string().regex(/^[a-f0-9]{64}(?![\s\S])/u);
const signedDecimal = z.string().regex(/^(?:0|-?[1-9][0-9]*)(?![\s\S])/u);
const unsignedDecimal = z.string().regex(/^(?:0|[1-9][0-9]*)(?![\s\S])/u);
const positiveDecimal = z.string().regex(/^[1-9][0-9]*(?![\s\S])/u);
const identitySchema = z.strictObject({
  dev: unsignedDecimal,
  ino: positiveDecimal,
  birthtimeNs: signedDecimal,
});
const copySourceSchema = z.strictObject({
  imageKey,
  relativePath: z.string().refine(projectRelativePath),
  byteSize,
  sha256,
});
const referenceSourceSchema = z.strictObject({
  imageKey,
  sourcePath: z.string().refine(localWindowsPath),
  identity: identitySchema,
  byteSize,
  mtimeNs: signedDecimal,
  sha256,
});
export const importSourceManifestSchema = jsonObject.pipe(z.discriminatedUnion('mode', [
  z.strictObject({
    formatVersion: z.literal(1),
    mode: z.literal('copy'),
    entries: z.array(copySourceSchema).min(1).max(MAX_INPUT_ITEMS),
  }),
  z.strictObject({
    formatVersion: z.literal(1),
    mode: z.literal('reference'),
    entries: z.array(referenceSourceSchema).min(1).max(MAX_INPUT_ITEMS),
  }),
]));

export type ImportSourceManifest = z.infer<typeof importSourceManifestSchema>;
export type CopyImportSource = Extract<ImportSourceManifest, { mode: 'copy' }>['entries'][number];
export type ReferenceImportSource = Extract<ImportSourceManifest, { mode: 'reference' }>['entries'][number];

/** Shared validation primitives for import persistence; no I/O or repository dependency. */
export {
  scalar as isImportScalar,
  jsonObject as importJsonObjectSchema,
  imageKey as importImageKeySchema,
  sha256 as importSha256Schema,
};

/** Type-only helper for DAT-12; persisted identities use the Project identity shape. */
export type ReferenceFileIdentity = ProjectFileIdentity;