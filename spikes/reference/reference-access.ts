import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import type { BigIntStats } from "node:fs";
import { link, mkdtemp, open, readFile, rename, rm, stat, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, normalize, resolve } from "node:path";

const MANIFEST_SCHEMA_VERSION = 1 as const;
const MAX_MANIFEST_BYTES = 64 * 1024;
const HASH_BUFFER_BYTES = 64 * 1024;

const EXIT = {
  success: 0,
  usage: 2,
  relinkRequired: 3,
  modified: 4,
  relinkRejected: 5,
  invalidManifest: 6,
  identityUnavailable: 7,
  raceDetected: 8,
  sourceProtection: 9,
  unexpected: 10,
} as const;

type SupportedPlatform = "win32" | "darwin";

type ResultStatus =
  | "SELECTED"
  | "VERIFIED"
  | "RELINKED"
  | "SELF_TESTED"
  | "INVALID_INPUT"
  | "RELINK_REQUIRED"
  | "MODIFIED"
  | "RELINK_REJECTED"
  | "INVALID_MANIFEST"
  | "IDENTITY_UNAVAILABLE"
  | "RACE_DETECTED"
  | "SOURCE_PROTECTION_BLOCKED"
  | "FAILED_CLOSED";

interface FileIdentity {
  readonly provider: "node-filehandle-bigint-stat-dev-ino";
  readonly dev: string;
  readonly ino: string;
}

interface SourceSnapshot {
  readonly identity: FileIdentity;
  readonly sizeBytes: string;
  readonly mtimeNs: string;
  readonly sha256: string;
}

interface ReferenceManifestV1 {
  readonly schemaVersion: typeof MANIFEST_SCHEMA_VERSION;
  readonly manifestRevision: number;
  readonly mode: "reference-read-only";
  readonly selection: "explicit-absolute-path";
  readonly platform: SupportedPlatform;
  readonly source: SourceSnapshot & {
    readonly absolutePath: string;
  };
}

interface LifecycleTestHooks {
  readonly afterSelectManifestWrite?: () => Promise<void>;
  readonly beforeSelectPathRecheck?: () => Promise<void>;
  readonly beforeVerifyPathRecheck?: () => Promise<void>;
  readonly afterRelinkManifestWrite?: () => Promise<void>;
  readonly beforeRelinkPathRecheck?: () => Promise<void>;
}

class SpikeFailure extends Error {
  constructor(
    readonly status: ResultStatus,
    readonly reason: string,
    readonly exitCode: number,
  ) {
    super(reason);
  }
}

function fail(status: ResultStatus, reason: string, exitCode: number): never {
  throw new SpikeFailure(status, reason, exitCode);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function isDecimal(value: unknown, allowZero: boolean): value is string {
  if (typeof value !== "string") {
    return false;
  }

  return (allowZero ? /^(?:0|[1-9]\d*)$/ : /^[1-9]\d*$/).test(value);
}

function supportedPlatform(): SupportedPlatform {
  if (process.platform === "win32" || process.platform === "darwin") {
    return process.platform;
  }

  fail("INVALID_INPUT", "UNSUPPORTED_PLATFORM", EXIT.usage);
}

function isFullyQualifiedPath(value: string): boolean {
  if (value.length === 0 || value.includes("\0")) return false;
  const normalized = normalize(value);
  if (!isAbsolute(normalized)) return false;
  if (process.platform !== "win32") return resolve(normalized) === normalized;
  if (normalized.startsWith("\\\\.\\")) return false;

  const extendedDrive = /^\\\\\?\\[A-Za-z]:\\/.exec(normalized);
  if (extendedDrive !== null) {
    return !normalized.slice(extendedDrive[0].length).includes(":");
  }
  const extendedUnc = /^\\\\\?\\UNC\\[^\\]+\\[^\\]+(?:\\|$)/i.test(normalized);
  if (extendedUnc) return !normalized.includes(":");

  const driveQualified = /^[A-Za-z]:\\/.exec(normalized);
  if (driveQualified !== null) {
    return !normalized.slice(driveQualified[0].length).includes(":");
  }
  const uncQualified = /^\\\\(?![?.]\\)[^\\]+\\[^\\]+(?:\\|$)/.test(normalized);
  return uncQualified && !normalized.includes(":");
}

function absolutePath(value: string, reason: string): string {
  if (!isFullyQualifiedPath(value)) {
    fail("INVALID_INPUT", reason, EXIT.usage);
  }

  return normalize(value);
}

function comparablePath(value: string): string {
  const normalized = normalize(value);
  return process.platform === "win32" ? normalized.toLocaleLowerCase("en-US") : normalized;
}

function samePath(left: string, right: string): boolean {
  return comparablePath(left) === comparablePath(right);
}

function identityFromStats(stats: BigIntStats): FileIdentity {
  if (stats.dev < 0n || stats.ino <= 0n) {
    fail("IDENTITY_UNAVAILABLE", "STABLE_FILE_ID_UNAVAILABLE", EXIT.identityUnavailable);
  }

  return {
    provider: "node-filehandle-bigint-stat-dev-ino",
    dev: stats.dev.toString(10),
    ino: stats.ino.toString(10),
  };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.provider === right.provider && left.dev === right.dev && left.ino === right.ino;
}

function sameSnapshot(left: SourceSnapshot, right: SourceSnapshot): boolean {
  return (
    sameIdentity(left.identity, right.identity) &&
    left.sizeBytes === right.sizeBytes &&
    left.mtimeNs === right.mtimeNs &&
    left.sha256 === right.sha256
  );
}

function isErrno(error: unknown, code: string): boolean {
  return isRecord(error) && error.code === code;
}

function mapSourceOpenFailure(error: unknown): never {
  if (isErrno(error, "ENOENT") || isErrno(error, "ENOTDIR")) {
    fail("RELINK_REQUIRED", "SOURCE_MISSING", EXIT.relinkRequired);
  }
  if (isErrno(error, "EACCES") || isErrno(error, "EPERM")) {
    fail("RELINK_REQUIRED", "SOURCE_INACCESSIBLE", EXIT.relinkRequired);
  }

  fail("RELINK_REQUIRED", "SOURCE_READ_FAILED", EXIT.relinkRequired);
}

async function openSourceReadOnly(path: string) {
  try {
    return await open(path, "r");
  } catch (error: unknown) {
    mapSourceOpenFailure(error);
  }
}

async function readIdentityIfPresent(path: string): Promise<FileIdentity | null> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch (error: unknown) {
    if (isErrno(error, "ENOENT") || isErrno(error, "ENOTDIR")) {
      return null;
    }
    fail("SOURCE_PROTECTION_BLOCKED", "SOURCE_ALIAS_CHECK_FAILED", EXIT.sourceProtection);
  }

  try {
    const stats = await handle.stat({ bigint: true });
    if (!stats.isFile()) {
      fail("SOURCE_PROTECTION_BLOCKED", "SOURCE_ALIAS_NOT_REGULAR_FILE", EXIT.sourceProtection);
    }
    return identityFromStats(stats);
  } finally {
    await handle.close();
  }
}

async function captureSource(path: string): Promise<SourceSnapshot> {
  const handle = await openSourceReadOnly(path);

  try {
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) {
      fail("RELINK_REQUIRED", "SOURCE_NOT_REGULAR_FILE", EXIT.relinkRequired);
    }

    const beforeIdentity = identityFromStats(before);
    const hash = createHash("sha256");
    const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
    let position = 0;

    for (;;) {
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (bytesRead === 0) {
        break;
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }

    const after = await handle.stat({ bigint: true });
    const afterIdentity = identityFromStats(after);
    if (
      !sameIdentity(beforeIdentity, afterIdentity) ||
      before.size !== after.size ||
      before.mtimeNs !== after.mtimeNs
    ) {
      fail("RACE_DETECTED", "SOURCE_CHANGED_DURING_READ", EXIT.raceDetected);
    }

    const snapshot: SourceSnapshot = {
      identity: afterIdentity,
      sizeBytes: after.size.toString(10),
      mtimeNs: after.mtimeNs.toString(10),
      sha256: hash.digest("hex"),
    };

    return snapshot;
  } catch (error: unknown) {
    if (error instanceof SpikeFailure) {
      throw error;
    }
    mapSourceOpenFailure(error);
  } finally {
    await handle.close();
  }
}

function parseManifest(text: string): ReferenceManifestV1 {
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    fail("INVALID_MANIFEST", "MANIFEST_JSON_INVALID", EXIT.invalidManifest);
  }

  if (
    !isRecord(value) ||
    !hasExactKeys(value, [
      "schemaVersion",
      "manifestRevision",
      "mode",
      "selection",
      "platform",
      "source",
    ]) ||
    value.schemaVersion !== MANIFEST_SCHEMA_VERSION ||
    !Number.isSafeInteger(value.manifestRevision) ||
    (value.manifestRevision as number) < 1 ||
    value.mode !== "reference-read-only" ||
    value.selection !== "explicit-absolute-path" ||
    (value.platform !== "win32" && value.platform !== "darwin") ||
    !isRecord(value.source) ||
    !hasExactKeys(value.source, ["absolutePath", "identity", "sizeBytes", "mtimeNs", "sha256"]) ||
    typeof value.source.absolutePath !== "string" ||
    !isFullyQualifiedPath(value.source.absolutePath) ||
    !isRecord(value.source.identity) ||
    !hasExactKeys(value.source.identity, ["provider", "dev", "ino"]) ||
    value.source.identity.provider !== "node-filehandle-bigint-stat-dev-ino" ||
    !isDecimal(value.source.identity.dev, true) ||
    !isDecimal(value.source.identity.ino, false) ||
    !isDecimal(value.source.sizeBytes, true) ||
    !isDecimal(value.source.mtimeNs, true) ||
    typeof value.source.sha256 !== "string" ||
    !/^[a-f0-9]{64}$/.test(value.source.sha256)
  ) {
    fail("INVALID_MANIFEST", "MANIFEST_SCHEMA_INVALID", EXIT.invalidManifest);
  }

  const manifest = value as unknown as ReferenceManifestV1;
  if (serializeManifest(manifest) !== text) {
    fail("INVALID_MANIFEST", "MANIFEST_JSON_NON_CANONICAL", EXIT.invalidManifest);
  }
  return manifest;
}

async function readManifestFromHandle(
  handle: Awaited<ReturnType<typeof open>>,
): Promise<{
  manifest: ReferenceManifestV1;
  text: string;
  snapshot: SourceSnapshot;
  atimeNs: string;
}> {
  const before = await handle.stat({ bigint: true });
  if (!before.isFile() || before.size > BigInt(MAX_MANIFEST_BYTES)) {
    fail("INVALID_MANIFEST", "MANIFEST_FILE_INVALID", EXIT.invalidManifest);
  }

  const identity = identityFromStats(before);
  const bytes = await handle.readFile();
  const text = bytes.toString("utf8");
  const after = await handle.stat({ bigint: true });
  if (
    !sameIdentity(identity, identityFromStats(after)) ||
    before.size !== after.size ||
    before.mtimeNs !== after.mtimeNs
  ) {
    fail("RACE_DETECTED", "MANIFEST_CHANGED_DURING_READ", EXIT.raceDetected);
  }

  return {
    manifest: parseManifest(text),
    text,
    snapshot: {
      identity,
      sizeBytes: after.size.toString(10),
      mtimeNs: after.mtimeNs.toString(10),
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    atimeNs: before.atimeNs.toString(10),
  };
}

async function readManifest(path: string): Promise<ReferenceManifestV1> {
  let handle;
  try {
    handle = await open(path, "r");
  } catch {
    fail("INVALID_MANIFEST", "MANIFEST_OPEN_FAILED", EXIT.invalidManifest);
  }

  try {
    return (await readManifestFromHandle(handle)).manifest;
  } finally {
    await handle.close();
  }
}

function serializeManifest(manifest: ReferenceManifestV1): string {
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

async function writeManifestHandle(handle: Awaited<ReturnType<typeof open>>, text: string): Promise<void> {
  const bytes = Buffer.from(text, "utf8");
  let offset = 0;
  while (offset < bytes.length) {
    const { bytesWritten } = await handle.write(bytes, offset, bytes.length - offset, offset);
    if (bytesWritten === 0) {
      fail("FAILED_CLOSED", "MANIFEST_WRITE_STALLED", EXIT.unexpected);
    }
    offset += bytesWritten;
  }
  await handle.truncate(bytes.length);
  await handle.sync();
}

async function rollbackManifestHandle(
  handle: Awaited<ReturnType<typeof open>>,
  text: string,
  atimeNs: string,
  mtimeNs: string,
): Promise<void> {
  await writeManifestHandle(handle, text);
  await handle.utimes(Number(atimeNs) / 1_000_000_000, Number(mtimeNs) / 1_000_000_000);
  await handle.sync();
}

async function rejectReferenceManifestSource(path: string): Promise<void> {
  const handle = await openSourceReadOnly(path);
  try {
    const metadata = await handle.stat({ bigint: true });
    if (!metadata.isFile() || metadata.size > BigInt(MAX_MANIFEST_BYTES)) return;
    const text = await handle.readFile("utf8");
    let candidate: unknown;
    try {
      candidate = JSON.parse(text) as unknown;
    } catch {
      return;
    }
    if (
      isRecord(candidate) &&
      candidate.schemaVersion === MANIFEST_SCHEMA_VERSION &&
      candidate.mode === "reference-read-only" &&
      candidate.selection === "explicit-absolute-path" &&
      isRecord(candidate.source)
    ) {
      fail(
        "SOURCE_PROTECTION_BLOCKED",
        "REFERENCE_MANIFEST_CANNOT_BE_SOURCE",
        EXIT.sourceProtection,
      );
    }
  } finally {
    await handle.close();
  }
}

async function requirePathSnapshot(
  path: string,
  expected: SourceSnapshot,
  reason: string,
): Promise<void> {
  let current: SourceSnapshot;
  try {
    current = await captureSource(path);
  } catch {
    fail("RACE_DETECTED", reason, EXIT.raceDetected);
  }
  if (!sameSnapshot(expected, current)) {
    fail("RACE_DETECTED", reason, EXIT.raceDetected);
  }
}

async function removeCreatedManifest(path: string, identity: FileIdentity): Promise<void> {
  const current = await readIdentityIfPresent(path);
  if (current === null) return;
  if (!sameIdentity(current, identity)) {
    fail(
      "RACE_DETECTED",
      "MANIFEST_PATH_CHANGED_DURING_CLEANUP",
      EXIT.raceDetected,
    );
  }
  await rm(path);
}

async function snapshotWrittenManifest(
  handle: Awaited<ReturnType<typeof open>>,
  text: string,
): Promise<SourceSnapshot> {
  const metadata = await handle.stat({ bigint: true });
  return {
    identity: identityFromStats(metadata),
    sizeBytes: metadata.size.toString(10),
    mtimeNs: metadata.mtimeNs.toString(10),
    sha256: createHash("sha256").update(text, "utf8").digest("hex"),
  };
}

function compareWithManifest(manifest: ReferenceManifestV1, current: SourceSnapshot): void {
  if (!sameIdentity(manifest.source.identity, current.identity)) {
    fail("MODIFIED", "IDENTITY_CHANGED", EXIT.modified);
  }
  if (manifest.source.sizeBytes !== current.sizeBytes) {
    fail("MODIFIED", "SIZE_CHANGED", EXIT.modified);
  }
  if (manifest.source.mtimeNs !== current.mtimeNs) {
    fail("MODIFIED", "MTIME_CHANGED", EXIT.modified);
  }
  if (manifest.source.sha256 !== current.sha256) {
    fail("MODIFIED", "HASH_CHANGED", EXIT.modified);
  }
}

async function selectSource(
  sourceArgument: string,
  manifestArgument: string,
  hooks: LifecycleTestHooks = {},
): Promise<void> {
  const platform = supportedPlatform();
  const sourcePath = absolutePath(sourceArgument, "SOURCE_PATH_MUST_BE_ABSOLUTE");
  const manifestPath = absolutePath(manifestArgument, "MANIFEST_PATH_MUST_BE_ABSOLUTE");
  if (samePath(sourcePath, manifestPath)) {
    fail("SOURCE_PROTECTION_BLOCKED", "MANIFEST_PATH_ALIASES_SOURCE", EXIT.sourceProtection);
  }

  await rejectReferenceManifestSource(sourcePath);
  const before = await captureSource(sourcePath);
  const manifest: ReferenceManifestV1 = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    manifestRevision: 1,
    mode: "reference-read-only",
    selection: "explicit-absolute-path",
    platform,
    source: {
      absolutePath: sourcePath,
      ...before,
    },
  };

  let handle;
  try {
    handle = await open(manifestPath, "wx");
  } catch {
    fail("INVALID_INPUT", "MANIFEST_MUST_NOT_ALREADY_EXIST", EXIT.usage);
  }

  const createdIdentity = identityFromStats(await handle.stat({ bigint: true }));
  let failure: unknown;
  try {
    const manifestText = serializeManifest(manifest);
    await writeManifestHandle(handle, manifestText);
    await hooks.afterSelectManifestWrite?.();
    const manifestSnapshot = await snapshotWrittenManifest(handle, manifestText);
    const after = await captureSource(sourcePath);
    if (!sameSnapshot(before, after)) {
      fail("RACE_DETECTED", "SOURCE_CHANGED_DURING_SELECTION", EXIT.raceDetected);
    }
    await hooks.beforeSelectPathRecheck?.();
    await requirePathSnapshot(sourcePath, after, "SOURCE_PATH_CHANGED_DURING_SELECTION");
    await requirePathSnapshot(
      manifestPath,
      manifestSnapshot,
      "MANIFEST_PATH_CHANGED_DURING_SELECTION",
    );
  } catch (error: unknown) {
    failure = error;
  } finally {
    try {
      await handle.close();
    } catch (error: unknown) {
      failure ??= error;
    }
  }

  if (failure !== undefined) {
    try {
      await removeCreatedManifest(manifestPath, createdIdentity);
    } catch (cleanupError: unknown) {
      if (cleanupError instanceof SpikeFailure) throw cleanupError;
      fail("FAILED_CLOSED", "MANIFEST_CLEANUP_FAILED", EXIT.unexpected);
    }
    throw failure;
  }
}

async function verifySource(
  manifestArgument: string,
  hooks: LifecycleTestHooks = {},
): Promise<void> {
  const manifestPath = absolutePath(manifestArgument, "MANIFEST_PATH_MUST_BE_ABSOLUTE");
  let manifestHandle;
  try {
    manifestHandle = await open(manifestPath, "r");
  } catch {
    fail("INVALID_MANIFEST", "MANIFEST_OPEN_FAILED", EXIT.invalidManifest);
  }
  let openedManifest;
  try {
    openedManifest = await readManifestFromHandle(manifestHandle);
  } finally {
    await manifestHandle.close();
  }
  const manifest = openedManifest.manifest;
  if (manifest.platform !== supportedPlatform()) {
    fail("INVALID_MANIFEST", "MANIFEST_PLATFORM_MISMATCH", EXIT.invalidManifest);
  }
  if (samePath(manifestPath, manifest.source.absolutePath)) {
    fail("SOURCE_PROTECTION_BLOCKED", "MANIFEST_PATH_ALIASES_SOURCE", EXIT.sourceProtection);
  }

  await rejectReferenceManifestSource(manifest.source.absolutePath);
  const current = await captureSource(manifest.source.absolutePath);
  compareWithManifest(manifest, current);
  await hooks.beforeVerifyPathRecheck?.();
  await requirePathSnapshot(
    manifestPath,
    openedManifest.snapshot,
    "MANIFEST_PATH_CHANGED_DURING_VERIFY",
  );
  await requirePathSnapshot(
    manifest.source.absolutePath,
    current,
    "SOURCE_PATH_CHANGED_DURING_VERIFY",
  );
}

async function relinkSource(
  manifestArgument: string,
  candidateArgument: string,
  hooks: LifecycleTestHooks = {},
): Promise<void> {
  const manifestPath = absolutePath(manifestArgument, "MANIFEST_PATH_MUST_BE_ABSOLUTE");
  const candidatePath = absolutePath(candidateArgument, "RELINK_PATH_MUST_BE_ABSOLUTE");
  if (samePath(manifestPath, candidatePath)) {
    fail("SOURCE_PROTECTION_BLOCKED", "RELINK_PATH_ALIASES_MANIFEST", EXIT.sourceProtection);
  }

  let manifestHandle;
  try {
    manifestHandle = await open(manifestPath, "r+");
  } catch {
    fail("INVALID_MANIFEST", "MANIFEST_OPEN_FAILED", EXIT.invalidManifest);
  }

  try {
    const openedManifest = await readManifestFromHandle(manifestHandle);
    const manifest = openedManifest.manifest;
    if (manifest.platform !== supportedPlatform()) {
      fail("INVALID_MANIFEST", "MANIFEST_PLATFORM_MISMATCH", EXIT.invalidManifest);
    }
    if (samePath(manifestPath, manifest.source.absolutePath)) {
      fail("SOURCE_PROTECTION_BLOCKED", "MANIFEST_PATH_ALIASES_SOURCE", EXIT.sourceProtection);
    }
    if (sameIdentity(openedManifest.snapshot.identity, manifest.source.identity)) {
      fail("SOURCE_PROTECTION_BLOCKED", "MANIFEST_FILE_ALIASES_SOURCE_ID", EXIT.sourceProtection);
    }

    const currentSourceIdentity = await readIdentityIfPresent(manifest.source.absolutePath);
    if (
      currentSourceIdentity !== null &&
      sameIdentity(openedManifest.snapshot.identity, currentSourceIdentity)
    ) {
      fail("SOURCE_PROTECTION_BLOCKED", "MANIFEST_FILE_HARDLINKS_SOURCE", EXIT.sourceProtection);
    }

    await requirePathSnapshot(
      manifestPath,
      openedManifest.snapshot,
      "MANIFEST_PATH_CHANGED_BEFORE_RELINK",
    );
    await rejectReferenceManifestSource(candidatePath);
    const candidate = await captureSource(candidatePath);
    if (sameIdentity(openedManifest.snapshot.identity, candidate.identity)) {
      fail("SOURCE_PROTECTION_BLOCKED", "RELINK_TARGET_HARDLINKS_MANIFEST", EXIT.sourceProtection);
    }
    if (candidate.sha256 !== manifest.source.sha256) {
      fail("RELINK_REJECTED", "SHA256_MISMATCH", EXIT.relinkRejected);
    }
    if (manifest.manifestRevision === Number.MAX_SAFE_INTEGER) {
      fail("INVALID_MANIFEST", "MANIFEST_REVISION_EXHAUSTED", EXIT.invalidManifest);
    }

    const updated: ReferenceManifestV1 = {
      ...manifest,
      manifestRevision: manifest.manifestRevision + 1,
      source: {
        absolutePath: candidatePath,
        ...candidate,
      },
    };
    const updatedText = serializeManifest(updated);
    let updateAttempted = false;
    try {
      updateAttempted = true;
      await writeManifestHandle(manifestHandle, updatedText);
      await hooks.afterRelinkManifestWrite?.();
      const candidateAfter = await captureSource(candidatePath);
      if (!sameSnapshot(candidate, candidateAfter)) {
        fail("RACE_DETECTED", "SOURCE_CHANGED_DURING_RELINK", EXIT.raceDetected);
      }
      await hooks.beforeRelinkPathRecheck?.();
      await requirePathSnapshot(
        candidatePath,
        candidateAfter,
        "SOURCE_PATH_CHANGED_DURING_RELINK",
      );
      const updatedSnapshot = await snapshotWrittenManifest(manifestHandle, updatedText);
      await requirePathSnapshot(
        manifestPath,
        updatedSnapshot,
        "MANIFEST_PATH_CHANGED_DURING_RELINK",
      );
    } catch (error: unknown) {
      if (updateAttempted) {
        try {
          await rollbackManifestHandle(
            manifestHandle,
            openedManifest.text,
            openedManifest.atimeNs,
            openedManifest.snapshot.mtimeNs,
          );
        } catch {
          fail("FAILED_CLOSED", "MANIFEST_ROLLBACK_FAILED", EXIT.unexpected);
        }
      }
      throw error;
    }
  } finally {
    await manifestHandle.close();
  }
}

function emit(status: ResultStatus, reason?: string): void {
  const result = reason === undefined ? { status } : { status, reason };
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

function usage(): never {
  fail("INVALID_INPUT", "USAGE", EXIT.usage);
}

interface FileProof {
  readonly identity: FileIdentity;
  readonly contentBase64: string;
  readonly sha256: string;
  readonly sizeBytes: string;
  readonly mtimeNs: string;
  readonly birthtimeNs: string;
  readonly links: string;
  readonly mode: string;
}

interface ChildResult {
  readonly status: string;
  readonly reason?: string;
  readonly exitCode: number;
}

async function fileProof(path: string): Promise<FileProof> {
  const [bytes, metadata] = await Promise.all([readFile(path), stat(path, { bigint: true })]);
  return {
    identity: identityFromStats(metadata),
    contentBase64: bytes.toString("base64"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    sizeBytes: metadata.size.toString(10),
    mtimeNs: metadata.mtimeNs.toString(10),
    birthtimeNs: metadata.birthtimeNs.toString(10),
    links: metadata.nlink.toString(10),
    mode: metadata.mode.toString(10),
  };
}

function requireEqual(left: unknown, right: unknown, label: string): void {
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw new Error(`SELF_TEST_MISMATCH:${label}`);
  }
}

async function requireFileUnchanged(before: FileProof, path: string, label: string): Promise<void> {
  const after = await fileProof(path);
  for (const key of Object.keys(before) as (keyof FileProof)[]) {
    requireEqual(after[key], before[key], `${label}:${key}`);
  }
}

async function requireManifestSemanticallyUnchanged(
  before: FileProof,
  path: string,
  label: string,
): Promise<void> {
  const after = await fileProof(path);
  for (const key of [
    "identity",
    "contentBase64",
    "sha256",
    "sizeBytes",
    "birthtimeNs",
    "links",
    "mode",
  ] as const) {
    requireEqual(after[key], before[key], `${label}:${key}`);
  }
}

async function requireMissing(path: string, label: string): Promise<void> {
  try {
    await stat(path);
  } catch (error: unknown) {
    if (isErrno(error, "ENOENT")) return;
    throw error;
  }
  throw new Error(`SELF_TEST_EXPECTED_MISSING:${label}`);
}

async function expectAsyncSpikeFailure(
  action: () => Promise<void>,
  expectedStatus: ResultStatus,
  expectedReason: string,
): Promise<void> {
  try {
    await action();
  } catch (error: unknown) {
    if (
      error instanceof SpikeFailure &&
      error.status === expectedStatus &&
      error.reason === expectedReason
    ) {
      return;
    }
    throw new Error(`SELF_TEST_ASYNC_FAILURE_MISMATCH:${expectedReason}`);
  }
  throw new Error(`SELF_TEST_ASYNC_FAILURE_MISSING:${expectedReason}`);
}

function runChild(scriptPath: string, args: readonly string[]): ChildResult {
  const child = spawnSync(process.execPath, [scriptPath, ...args], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (child.error !== undefined || child.signal !== null || child.status === null) {
    throw new Error("SELF_TEST_CHILD_FAILED");
  }
  const lines = child.stdout.trim().split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length !== 1 || child.stderr.trim().length !== 0) {
    throw new Error("SELF_TEST_CHILD_OUTPUT_INVALID");
  }
  const parsed = JSON.parse(lines[0]) as unknown;
  if (`${JSON.stringify(parsed)}\n` !== child.stdout) {
    throw new Error("SELF_TEST_CHILD_JSON_NOT_CANONICAL");
  }
  const expectedKeys = child.status === 0 ? ["status"] : ["reason", "status"];
  if (
    !isRecord(parsed) ||
    !hasExactKeys(parsed, expectedKeys) ||
    typeof parsed.status !== "string" ||
    (parsed.reason !== undefined && typeof parsed.reason !== "string")
  ) {
    throw new Error("SELF_TEST_CHILD_JSON_INVALID");
  }
  return {
    status: parsed.status,
    ...(typeof parsed.reason === "string" ? { reason: parsed.reason } : {}),
    exitCode: child.status,
  };
}

function expectChild(
  scriptPath: string,
  args: readonly string[],
  expectedStatus: string,
  expectedExit: number,
  expectedReason?: string,
): void {
  const actual = runChild(scriptPath, args);
  const label = `${expectedStatus}:${expectedReason ?? "NO_REASON"}`;
  requireEqual(actual.status, expectedStatus, `${label}:status`);
  requireEqual(actual.exitCode, expectedExit, `${label}:exit`);
  if (expectedReason !== undefined) {
    requireEqual(actual.reason, expectedReason, `${label}:reason`);
  } else {
    requireEqual(actual.reason, undefined, `${label}:reason-absent`);
  }
}

async function createSelectedFixture(
  root: string,
  name: string,
  scriptPath: string,
): Promise<{ source: string; manifest: string; bytes: Buffer }> {
  const bytes = Buffer.from(`spi19-read-only-${name}`, "utf8");
  const source = join(root, `${name}-source.bin`);
  const manifest = join(root, `${name}-manifest.json`);
  await writeFile(source, bytes, { flag: "wx" });
  const sourceBefore = await fileProof(source);
  expectChild(scriptPath, ["select", source, manifest], "SELECTED", EXIT.success);
  await requireFileUnchanged(sourceBefore, source, `${name}-select-source`);
  return { source, manifest, bytes };
}

async function runSelfTest(): Promise<readonly string[]> {
  const scriptArgument = process.argv[1];
  if (scriptArgument === undefined) {
    throw new Error("SELF_TEST_SCRIPT_PATH_MISSING");
  }
  const scriptPath = resolve(scriptArgument);
  const root = await mkdtemp(join(tmpdir(), "autovision-spi19-selftest-"));
  const cases: string[] = [];
  try {
    const lifecycle = await createSelectedFixture(root, "lifecycle", scriptPath);
    const selectedProof = await fileProof(lifecycle.source);
    cases.push("absolute-select-read-only");
    const manifestBeforeVerify = await fileProof(lifecycle.manifest);
    expectChild(scriptPath, ["verify", lifecycle.manifest], "VERIFIED", EXIT.success);
    await requireFileUnchanged(selectedProof, lifecycle.source, "verify-source");
    await requireFileUnchanged(manifestBeforeVerify, lifecycle.manifest, "verify-manifest");
    cases.push("separate-process-verify-read-only");

    const wrong = join(root, "wrong.bin");
    await writeFile(wrong, Buffer.from("different-content", "utf8"), { flag: "wx" });
    const wrongProof = await fileProof(wrong);
    const manifestBeforeWrongRelink = await fileProof(lifecycle.manifest);
    expectChild(
      scriptPath,
      ["relink", lifecycle.manifest, wrong],
      "RELINK_REJECTED",
      EXIT.relinkRejected,
      "SHA256_MISMATCH",
    );
    await requireFileUnchanged(wrongProof, wrong, "wrong-relink-source");
    await requireFileUnchanged(
      manifestBeforeWrongRelink,
      lifecycle.manifest,
      "wrong-relink-manifest",
    );
    cases.push("hash-mismatch-relink-rejected-read-only");

    const moved = join(root, "lifecycle-moved.bin");
    await rename(lifecycle.source, moved);
    const movedProof = await fileProof(moved);
    expectChild(
      scriptPath,
      ["verify", lifecycle.manifest],
      "RELINK_REQUIRED",
      EXIT.relinkRequired,
      "SOURCE_MISSING",
    );
    await requireFileUnchanged(movedProof, moved, "missing-source-target");
    cases.push("missing-source-detected");
    expectChild(scriptPath, ["relink", lifecycle.manifest, moved], "RELINKED", EXIT.success);
    await requireFileUnchanged(movedProof, moved, "successful-relink-source");
    cases.push("same-file-relink-read-only");
    const manifestAfterRelink = await fileProof(lifecycle.manifest);
    expectChild(scriptPath, ["verify", lifecycle.manifest], "VERIFIED", EXIT.success);
    await requireFileUnchanged(movedProof, moved, "post-relink-verify-source");
    await requireFileUnchanged(manifestAfterRelink, lifecycle.manifest, "post-relink-manifest");
    cases.push("post-relink-separate-process-verify");

    const identityOriginal = await createSelectedFixture(root, "identity", scriptPath);
    const originalMetadata = await stat(identityOriginal.source, { bigint: true });
    await rm(identityOriginal.source);
    await writeFile(identityOriginal.source, identityOriginal.bytes, { flag: "wx" });
    await utimes(identityOriginal.source, originalMetadata.atime, originalMetadata.mtime);
    const replacementProof = await fileProof(identityOriginal.source);
    expectChild(
      scriptPath,
      ["verify", identityOriginal.manifest],
      "MODIFIED",
      EXIT.modified,
      "IDENTITY_CHANGED",
    );
    await requireFileUnchanged(replacementProof, identityOriginal.source, "identity-source");
    cases.push("replacement-identity-detected");
    expectChild(
      scriptPath,
      ["relink", identityOriginal.manifest, identityOriginal.source],
      "RELINKED",
      EXIT.success,
    );
    await requireFileUnchanged(replacementProof, identityOriginal.source, "identity-relink-source");
    cases.push("replacement-identity-relink-read-only");

    const mtimeFixture = await createSelectedFixture(root, "mtime", scriptPath);
    const mtimeMetadata = await stat(mtimeFixture.source);
    await utimes(
      mtimeFixture.source,
      mtimeMetadata.atime,
      new Date(mtimeMetadata.mtimeMs + 2_000),
    );
    const changedMtimeProof = await fileProof(mtimeFixture.source);
    expectChild(
      scriptPath,
      ["verify", mtimeFixture.manifest],
      "MODIFIED",
      EXIT.modified,
      "MTIME_CHANGED",
    );
    await requireFileUnchanged(changedMtimeProof, mtimeFixture.source, "mtime-source");
    cases.push("mtime-change-detected-read-only");

    const hashFixture = await createSelectedFixture(root, "hashcheck", scriptPath);
    await writeFile(hashFixture.source, Buffer.from("changed-read-only-hash", "utf8"));
    const changedHashProof = await fileProof(hashFixture.source);
    const hashManifest = JSON.parse(await readFile(hashFixture.manifest, "utf8")) as Record<
      string,
      unknown
    >;
    const hashSource = hashManifest.source;
    if (!isRecord(hashSource)) throw new Error("SELF_TEST_MANIFEST_SOURCE_INVALID");
    hashSource.identity = (await captureSource(hashFixture.source)).identity;
    hashSource.sizeBytes = changedHashProof.sizeBytes;
    hashSource.mtimeNs = changedHashProof.mtimeNs;
    await writeFile(hashFixture.manifest, `${JSON.stringify(hashManifest, null, 2)}\n`);
    expectChild(
      scriptPath,
      ["verify", hashFixture.manifest],
      "MODIFIED",
      EXIT.modified,
      "HASH_CHANGED",
    );
    await requireFileUnchanged(changedHashProof, hashFixture.source, "hash-source");
    cases.push("hash-change-detected-read-only");

    const protectedSource = join(root, "protected-source.bin");
    await writeFile(protectedSource, Buffer.from("protected", "utf8"), { flag: "wx" });
    const protectedProof = await fileProof(protectedSource);
    expectChild(
      scriptPath,
      ["select", protectedSource, protectedSource],
      "SOURCE_PROTECTION_BLOCKED",
      EXIT.sourceProtection,
      "MANIFEST_PATH_ALIASES_SOURCE",
    );
    await requireFileUnchanged(protectedProof, protectedSource, "same-path-source");
    cases.push("same-path-source-protected");

    const aliasSource = join(root, "alias-source.bin");
    const aliasManifest = join(root, "alias-manifest.json");
    await writeFile(aliasSource, Buffer.from("alias", "utf8"), { flag: "wx" });
    await link(aliasSource, aliasManifest);
    const aliasProof = await fileProof(aliasSource);
    expectChild(
      scriptPath,
      ["select", aliasSource, aliasManifest],
      "INVALID_INPUT",
      EXIT.usage,
      "MANIFEST_MUST_NOT_ALREADY_EXIST",
    );
    await requireFileUnchanged(aliasProof, aliasSource, "hardlink-output-source");
    cases.push("hardlink-manifest-output-protected");

    const protection = await createSelectedFixture(root, "protection", scriptPath);
    const protectionProof = await fileProof(protection.source);
    expectChild(
      scriptPath,
      ["relink", protection.manifest, protection.manifest],
      "SOURCE_PROTECTION_BLOCKED",
      EXIT.sourceProtection,
      "RELINK_PATH_ALIASES_MANIFEST",
    );
    await requireFileUnchanged(protectionProof, protection.source, "manifest-candidate-source");
    cases.push("manifest-as-relink-target-protected");
    const manifestHardlink = join(root, "manifest-hardlink.json");
    await link(protection.manifest, manifestHardlink);
    const protectionManifestProof = await fileProof(protection.manifest);
    expectChild(
      scriptPath,
      ["relink", protection.manifest, manifestHardlink],
      "SOURCE_PROTECTION_BLOCKED",
      EXIT.sourceProtection,
      "REFERENCE_MANIFEST_CANNOT_BE_SOURCE",
    );
    await requireFileUnchanged(protectionProof, protection.source, "manifest-hardlink-source");
    await requireFileUnchanged(
      protectionManifestProof,
      protection.manifest,
      "manifest-hardlink-manifest",
    );
    cases.push("manifest-hardlink-relink-target-protected");

    const relativeManifest = join(root, "relative-manifest.json");
    expectChild(
      scriptPath,
      ["select", "relative-source.bin", relativeManifest],
      "INVALID_INPUT",
      EXIT.usage,
      "SOURCE_PATH_MUST_BE_ABSOLUTE",
    );
    cases.push("relative-source-rejected");

    if (process.platform === "win32") {
      const rootRelativeSource = "\\relative-source.bin";
      expectChild(
        scriptPath,
        ["select", rootRelativeSource, relativeManifest],
        "INVALID_INPUT",
        EXIT.usage,
        "SOURCE_PATH_MUST_BE_ABSOLUTE",
      );
      cases.push("windows-root-relative-source-rejected");

      const adsSource = join(root, "ads-source.bin");
      const adsManifest = `${adsSource}:autovision-manifest`;
      await writeFile(adsSource, Buffer.from("ads-protection", "utf8"), { flag: "wx" });
      const adsProof = await fileProof(adsSource);
      expectChild(
        scriptPath,
        ["select", adsSource, adsManifest],
        "INVALID_INPUT",
        EXIT.usage,
        "MANIFEST_PATH_MUST_BE_ABSOLUTE",
      );
      await requireFileUnchanged(adsProof, adsSource, "ads-source");
      cases.push("windows-ads-manifest-rejected");

      const extendedSource = join(root, "extended-source.bin");
      const extendedManifest = join(root, "extended-manifest.json");
      await writeFile(extendedSource, Buffer.from("extended-path", "utf8"), { flag: "wx" });
      const extendedProof = await fileProof(extendedSource);
      const extendedSourcePath = `\\\\?\\${extendedSource}`;
      const extendedManifestPath = `\\\\?\\${extendedManifest}`;
      expectChild(
        scriptPath,
        ["select", extendedSourcePath, extendedManifestPath],
        "SELECTED",
        EXIT.success,
      );
      expectChild(scriptPath, ["verify", extendedManifestPath], "VERIFIED", EXIT.success);
      await requireFileUnchanged(extendedProof, extendedSource, "extended-source");
      cases.push("windows-extended-drive-path-round-trip");
    }

    const invalidManifest = join(root, "invalid-manifest.json");
    await writeFile(invalidManifest, "{}\n", { flag: "wx" });
    const invalidProof = await fileProof(invalidManifest);
    expectChild(
      scriptPath,
      ["verify", invalidManifest],
      "INVALID_MANIFEST",
      EXIT.invalidManifest,
      "MANIFEST_SCHEMA_INVALID",
    );
    await requireFileUnchanged(invalidProof, invalidManifest, "invalid-manifest");
    cases.push("invalid-schema-rejected-read-only");

    const oversizedManifest = join(root, "oversized-manifest.json");
    await writeFile(oversizedManifest, Buffer.alloc(MAX_MANIFEST_BYTES + 1, 0x20), { flag: "wx" });
    const oversizedProof = await fileProof(oversizedManifest);
    expectChild(
      scriptPath,
      ["verify", oversizedManifest],
      "INVALID_MANIFEST",
      EXIT.invalidManifest,
      "MANIFEST_FILE_INVALID",
    );
    await requireFileUnchanged(oversizedProof, oversizedManifest, "oversized-manifest");
    cases.push("oversized-manifest-rejected-read-only");

    const platformFixture = await createSelectedFixture(root, "platform", scriptPath);
    const platformManifest = JSON.parse(
      await readFile(platformFixture.manifest, "utf8"),
    ) as Record<string, unknown>;
    platformManifest.platform = process.platform === "win32" ? "darwin" : "win32";
    await writeFile(platformFixture.manifest, `${JSON.stringify(platformManifest, null, 2)}\n`);
    const platformSourceProof = await fileProof(platformFixture.source);
    expectChild(
      scriptPath,
      ["verify", platformFixture.manifest],
      "INVALID_MANIFEST",
      EXIT.invalidManifest,
      "MANIFEST_PLATFORM_MISMATCH",
    );
    await requireFileUnchanged(platformSourceProof, platformFixture.source, "platform-source");
    cases.push("platform-mismatch-rejected-read-only");

    const epochFixture = join(root, "epoch-source.bin");
    const epochManifest = join(root, "epoch-manifest.json");
    await writeFile(epochFixture, Buffer.from("epoch-mtime", "utf8"), { flag: "wx" });
    await utimes(epochFixture, new Date(0), new Date(0));
    const epochProof = await fileProof(epochFixture);
    expectChild(scriptPath, ["select", epochFixture, epochManifest], "SELECTED", EXIT.success);
    expectChild(scriptPath, ["verify", epochManifest], "VERIFIED", EXIT.success);
    await requireFileUnchanged(epochProof, epochFixture, "epoch-source");
    cases.push("epoch-mtime-round-trip-read-only");

    const manifestSourceTarget = join(root, "manifest-source-target.json");
    const referenceManifestProof = await fileProof(protection.manifest);
    expectChild(
      scriptPath,
      ["select", protection.manifest, manifestSourceTarget],
      "SOURCE_PROTECTION_BLOCKED",
      EXIT.sourceProtection,
      "REFERENCE_MANIFEST_CANNOT_BE_SOURCE",
    );
    await requireFileUnchanged(
      referenceManifestProof,
      protection.manifest,
      "reference-manifest-source",
    );
    cases.push("reference-manifest-cannot-be-source");

    const cleanupSource = join(root, "cleanup-source.bin");
    const cleanupManifest = join(root, "cleanup-manifest.json");
    await writeFile(cleanupSource, Buffer.from("cleanup-source", "utf8"), { flag: "wx" });
    const cleanupProof = await fileProof(cleanupSource);
    await expectAsyncSpikeFailure(
      () =>
        selectSource(cleanupSource, cleanupManifest, {
          afterSelectManifestWrite: async () => {
            fail("RACE_DETECTED", "SELF_TEST_SELECT_POSTWRITE_FAILURE", EXIT.raceDetected);
          },
        }),
      "RACE_DETECTED",
      "SELF_TEST_SELECT_POSTWRITE_FAILURE",
    );
    await requireMissing(cleanupManifest, "select-cleanup-manifest");
    await requireFileUnchanged(cleanupProof, cleanupSource, "select-cleanup-source");
    cases.push("select-failure-removes-created-manifest");

    const selectBindingSource = join(root, "select-binding-source.bin");
    const selectBindingBackup = join(root, "select-binding-backup.bin");
    const selectBindingManifest = join(root, "select-binding-manifest.json");
    const selectBindingBytes = Buffer.from("select-binding", "utf8");
    await writeFile(selectBindingSource, selectBindingBytes, { flag: "wx" });
    const selectBindingProof = await fileProof(selectBindingSource);
    await expectAsyncSpikeFailure(
      () =>
        selectSource(selectBindingSource, selectBindingManifest, {
          beforeSelectPathRecheck: async () => {
            await rename(selectBindingSource, selectBindingBackup);
            await writeFile(selectBindingSource, selectBindingBytes, { flag: "wx" });
          },
        }),
      "RACE_DETECTED",
      "SOURCE_PATH_CHANGED_DURING_SELECTION",
    );
    await requireMissing(selectBindingManifest, "select-binding-manifest");
    await requireFileUnchanged(
      selectBindingProof,
      selectBindingBackup,
      "select-binding-original-source",
    );
    cases.push("select-path-rebinding-detected-and-cleaned");

    const verifyBinding = await createSelectedFixture(root, "verify-binding", scriptPath);
    const verifyManifestText = await readFile(verifyBinding.manifest);
    const verifyManifestBackup = join(root, "verify-binding-manifest-backup.json");
    const verifySourceProof = await fileProof(verifyBinding.source);
    await expectAsyncSpikeFailure(
      () =>
        verifySource(verifyBinding.manifest, {
          beforeVerifyPathRecheck: async () => {
            await rename(verifyBinding.manifest, verifyManifestBackup);
            await writeFile(verifyBinding.manifest, verifyManifestText, { flag: "wx" });
          },
        }),
      "RACE_DETECTED",
      "MANIFEST_PATH_CHANGED_DURING_VERIFY",
    );
    await requireFileUnchanged(verifySourceProof, verifyBinding.source, "verify-binding-source");
    cases.push("verify-manifest-path-rebinding-detected");

    const rollback = await createSelectedFixture(root, "rollback", scriptPath);
    const rollbackCandidate = join(root, "rollback-candidate.bin");
    await rename(rollback.source, rollbackCandidate);
    const rollbackManifestProof = await fileProof(rollback.manifest);
    await expectAsyncSpikeFailure(
      () =>
        relinkSource(rollback.manifest, rollbackCandidate, {
          afterRelinkManifestWrite: async () => {
            await writeFile(rollbackCandidate, Buffer.from("rollback-mutated", "utf8"));
          },
        }),
      "RACE_DETECTED",
      "SOURCE_CHANGED_DURING_RELINK",
    );
    await requireManifestSemanticallyUnchanged(
      rollbackManifestProof,
      rollback.manifest,
      "relink-rollback-manifest",
    );
    cases.push("relink-postwrite-failure-rolls-back-manifest");

    const relinkBinding = await createSelectedFixture(root, "relink-binding", scriptPath);
    const relinkBindingCandidate = join(root, "relink-binding-candidate.bin");
    const relinkBindingBackup = join(root, "relink-binding-backup.bin");
    await rename(relinkBinding.source, relinkBindingCandidate);
    const relinkBindingBytes = await readFile(relinkBindingCandidate);
    const relinkBindingManifestProof = await fileProof(relinkBinding.manifest);
    await expectAsyncSpikeFailure(
      () =>
        relinkSource(relinkBinding.manifest, relinkBindingCandidate, {
          beforeRelinkPathRecheck: async () => {
            await rename(relinkBindingCandidate, relinkBindingBackup);
            await writeFile(relinkBindingCandidate, relinkBindingBytes, { flag: "wx" });
          },
        }),
      "RACE_DETECTED",
      "SOURCE_PATH_CHANGED_DURING_RELINK",
    );
    await requireManifestSemanticallyUnchanged(
      relinkBindingManifestProof,
      relinkBinding.manifest,
      "relink-binding-manifest",
    );
    cases.push("relink-path-rebinding-rolls-back-manifest");

    const duplicateKey = await createSelectedFixture(root, "duplicate-key", scriptPath);
    const duplicateKeyText = await readFile(duplicateKey.manifest, "utf8");
    await writeFile(
      duplicateKey.manifest,
      duplicateKeyText.replace("{\n", '{\n  "schemaVersion": 999,\n'),
      "utf8",
    );
    const duplicateKeySourceProof = await fileProof(duplicateKey.source);
    const duplicateKeyManifestProof = await fileProof(duplicateKey.manifest);
    expectChild(
      scriptPath,
      ["verify", duplicateKey.manifest],
      "INVALID_MANIFEST",
      EXIT.invalidManifest,
      "MANIFEST_JSON_NON_CANONICAL",
    );
    await requireFileUnchanged(
      duplicateKeySourceProof,
      duplicateKey.source,
      "duplicate-key-source",
    );
    await requireFileUnchanged(
      duplicateKeyManifestProof,
      duplicateKey.manifest,
      "duplicate-key-manifest",
    );
    cases.push("duplicate-manifest-key-rejected-read-only");

    const expectedCaseCount = process.platform === "win32" ? 29 : 26;
    if (cases.length !== expectedCaseCount) throw new Error("SELF_TEST_CASE_COUNT_MISMATCH");
    return cases;
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case "self-test": {
      if (args.length !== 0) usage();
      try {
        const cases = await runSelfTest();
        emit("SELF_TESTED", `${cases.length}_CASES_PASS`);
      } catch (error: unknown) {
        if (error instanceof Error && error.message.startsWith("SELF_TEST_")) {
          fail("FAILED_CLOSED", error.message, EXIT.unexpected);
        }
        throw error;
      }
      return;
    }
    case "select":
      if (args.length !== 2) usage();
      await selectSource(args[0], args[1]);
      emit("SELECTED");
      return;
    case "verify":
      if (args.length !== 1) usage();
      await verifySource(args[0]);
      emit("VERIFIED");
      return;
    case "relink":
      if (args.length !== 2) usage();
      await relinkSource(args[0], args[1]);
      emit("RELINKED");
      return;
    default:
      usage();
  }
}

void main().catch((error: unknown) => {
  if (error instanceof SpikeFailure) {
    emit(error.status, error.reason);
    process.exitCode = error.exitCode;
    return;
  }

  emit("FAILED_CLOSED", "UNEXPECTED_ERROR");
  process.exitCode = EXIT.unexpected;
});
