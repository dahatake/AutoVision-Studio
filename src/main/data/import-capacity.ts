import native from 'node:fs';
import fs from 'node:fs/promises';
import { win32 } from 'node:path';

/** Main-only inputs. Every *Bytes field is an exact bigint byte count, not blocks or MiB. */
export interface ImportCapacityRequirements {
  readonly mode: 'copy' | 'reference';
  /** Verified original total, retained even when Reference copies no originals. */
  readonly sourceBytes: bigint;
  /** Caller-estimated local outputs, including Reference metadata/cache/notices. */
  readonly generatedBytes: bigint;
  /** Caller-estimated additional temporary space on the destination volume. */
  readonly temporaryBytes: bigint;
}

export interface ImportCapacityInput extends ImportCapacityRequirements {
  readonly availableBytes: bigint;
}

/** Immutable byte breakdown; sufficient is an observation, not a space reservation. */
export interface ImportCapacity extends ImportCapacityInput {
  readonly copiedBytes: bigint;
  readonly safetyBytes: bigint;
  readonly requiredBytes: bigint;
  readonly sufficient: boolean;
}

function invalidRequirements(): never {
  throw new TypeError('取り込み方式と、0以上のbigintによる容量（bytes）を明示してください。');
}

function capacityField(input: ImportCapacityRequirements, key: keyof ImportCapacityInput): unknown {
  const field = Object.getOwnPropertyDescriptor(input, key);
  if (!field || !Object.hasOwn(field, 'value')) invalidRequirements();
  return field.value as unknown;
}

function byteCount(value: unknown): bigint {
  if (typeof value !== 'bigint' || value < 0n) invalidRequirements();
  return value;
}

function snapshotRequirements(input: ImportCapacityRequirements): ImportCapacityRequirements {
  if (typeof input !== 'object' || input === null || Array.isArray(input)
    || (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null)) invalidRequirements();
  const mode = capacityField(input, 'mode');
  if (mode !== 'copy' && mode !== 'reference') invalidRequirements();
  return Object.freeze({ mode,
    sourceBytes: byteCount(capacityField(input, 'sourceBytes')),
    generatedBytes: byteCount(capacityField(input, 'generatedBytes')),
    temporaryBytes: byteCount(capacityField(input, 'temporaryBytes')) });
}

/** NFR-STO-001 / FR-DAT-002. No I/O, number conversion, inferred ratio or fixed budget.
 * Zero estimates mean known zero, never unknown. Sample/metadata parsing limits
 * are not normal-import transfer limits. Bigint arithmetic has no fixed-width overflow.
 */
export function calculateImportCapacity(input: ImportCapacityInput): ImportCapacity {
  const requirements = snapshotRequirements(input);
  const availableBytes = byteCount(capacityField(input, 'availableBytes'));
  const copiedBytes = requirements.mode === 'copy' ? requirements.sourceBytes : 0n;
  const base = copiedBytes + requirements.generatedBytes + requirements.temporaryBytes;
  const safetyBytes = (base + 4n) / 5n; // Exactly ceil(base / 5): 20%, rounded UP to a byte.
  const requiredBytes = base + safetyBytes;
  return Object.freeze({ ...requirements, copiedBytes, safetyBytes, requiredBytes, availableBytes,
    sufficient: availableBytes >= requiredBytes });
}

interface DirectoryIdentity {
  readonly path: string;
  readonly dev: bigint;
  readonly ino: bigint;
  readonly birthtimeNs: bigint;
}

interface DestinationSnapshot {
  readonly path: string;
  readonly canonicalPath: string;
  readonly chain: readonly DirectoryIdentity[];
}

function localDirectoryPath(input: string): string {
  // Same local Windows spelling policy as the existing Main asset checks.
  // Reject dot segments BEFORE normalization so a junction cannot disappear
  // from the checked chain. No UNC/device/ADS paths or implicit cwd resolution.
  if (process.platform !== 'win32' || typeof input !== 'string' || input.length > 32_767
    || !input.isWellFormed() || !/^[a-z]:[\\/]/iu.test(input)) {
    throw new TypeError('取り込み先にはローカルのWindows絶対フォルダーパスが必要です。');
  }
  const path = input.replaceAll('/', '\\');
  const parts = path.slice(3).split('\\');
  if (parts.at(-1) === '') parts.pop();
  if (parts.some((part) => !part || part.length > 255 || part === '.' || part === '..'
    || /[\u0000-\u001f\u007f<>:"/\\|?*]/u.test(part) || /[ .]$/u.test(part)
    || /^(?:con|conin\$|conout\$|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/iu.test(part))) {
    throw new TypeError('取り込み先に安全でないWindowsフォルダー名があります。');
  }
  // A drive root can be queried; this grants no Project ownership or write permission.
  return parts.length === 0 ? path.slice(0, 3) : win32.normalize(path).replace(/\\$/u, '');
}

function directoryIdentity(path: string): DirectoryIdentity {
  const stat = native.lstatSync(path, { bigint: true });
  if (stat.isSymbolicLink() || !stat.isDirectory()
    || typeof stat.dev !== 'bigint' || stat.dev < 0n
    || typeof stat.ino !== 'bigint' || stat.ino <= 0n || typeof stat.birthtimeNs !== 'bigint') {
    throw new Error('取り込み先にリンク・非通常フォルダーがあるか、同一性を確認できません。');
  }
  return Object.freeze({ path, dev: stat.dev, ino: stat.ino, birthtimeNs: stat.birthtimeNs });
}

function directoryChain(path: string): DirectoryIdentity[] {
  let cursor = win32.parse(path).root;
  const chain = [directoryIdentity(cursor)];
  for (const part of path.slice(cursor.length).split('\\')) {
    if (!part) continue;
    cursor = win32.join(cursor, part);
    chain.push(directoryIdentity(cursor));
  }
  return chain;
}

function sameIdentity(a: DirectoryIdentity, b: DirectoryIdentity): boolean {
  return a.dev === b.dev && a.ino === b.ino && a.birthtimeNs === b.birthtimeNs;
}

function changed(): never { throw new Error('容量確認中に取り込み先のパスまたは実体が変更されました。'); }

function checkChain(chain: readonly DirectoryIdentity[]): void {
  for (const entry of chain) {
    // Sibling activity may change ancestor size/mtime/ctime/nlink, not identity.
    if (!sameIdentity(entry, directoryIdentity(entry.path))) changed();
  }
}

function checkDestination(destination: DestinationSnapshot): void {
  checkChain(destination.chain);
  for (const path of new Set([destination.path, destination.canonicalPath])) {
    if (localDirectoryPath(native.realpathSync.native(path)) !== destination.canonicalPath) changed();
  }
  checkChain(destination.chain);
}

function inspectDestination(input: string): DestinationSnapshot {
  const path = localDirectoryPath(input);
  const original = directoryChain(path);
  const canonicalPath = localDirectoryPath(native.realpathSync.native(path));
  const pathKey = (value: string) => value.replace(/[A-Z]/g, (letter) => letter.toLowerCase());
  if (pathKey(path) !== pathKey(canonicalPath)) {
    throw new Error('取り込み先には別名やリンクを含まない正規のフォルダーパスが必要です。');
  }
  const canonical = canonicalPath === path ? original : directoryChain(canonicalPath);
  // Case-insensitive spelling alone is not evidence on case-sensitive Windows directories.
  if (original.length !== canonical.length || original.some((entry, index) => !sameIdentity(entry, canonical[index]!))) changed();
  const destination = { path, canonicalPath, chain: canonicalPath === path ? original : [...original, ...canonical] };
  checkDestination(destination);
  return destination;
}

/** DAT-11: one read-only statfs observation of an EXISTING local destination.
 * DAT-08 supplies its validated Project root/parent, verifies ownership/selection
 * and source access, and must stop BEFORE copying/writing if sufficient is false.
 * All three totals are required even for Reference; originals are not walked here.
 * No directory creation, source reads, notifications, reservation or implicit retry.
 * The full chain is pinned before statfs and checked synchronously after its await;
 * this is not an OS-atomic lock or a guarantee against later external changes.
 */
export async function preflightImportCapacity(destinationPath: string, requirements: ImportCapacityRequirements): Promise<ImportCapacity> {
  const requested = snapshotRequirements(requirements); // Copy caller data before the first await/I/O.
  const destination = inspectDestination(destinationPath);
  const { bavail, bsize } = await fs.statfs(destination.canonicalPath, { bigint: true });
  // Match Core's arithmetic: negative bavail is invalid, NOT zero or unlimited.
  if (typeof bavail !== 'bigint' || bavail < 0n || typeof bsize !== 'bigint' || bsize <= 0n) {
    throw new Error('取り込み先の空き容量を正確に取得できません。');
  }
  checkDestination(destination);
  return calculateImportCapacity({ ...requested, availableBytes: bavail * bsize });
}