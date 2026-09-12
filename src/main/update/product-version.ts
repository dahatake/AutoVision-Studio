export type ProductVersion = Readonly<{
  major: bigint;
  minor: bigint;
  patch: bigint;
}>;

/** Main-only numeric product version. Not a DB/schema/worker compatibility claim. */
export function parseProductVersion(value: unknown): ProductVersion {
  const match = typeof value === 'string'
    ? /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.exec(value) : null;
  // JavaScript's $ can match before a final newline. Require every character.
  if (!match || match[0] !== value) {
    throw new TypeError('製品バージョンは、先頭ゼロのない非負整数3要素（MAJOR.MINOR.PATCH）で指定してください。');
  }
  return Object.freeze({ major: BigInt(match[1]), minor: BigInt(match[2]), patch: BigInt(match[3]) });
}

/** Compare left to right, without inferring data compatibility or performing I/O. */
export function compareProductVersions(left: unknown, right: unknown): -1 | 0 | 1 {
  const a = parseProductVersion(left), b = parseProductVersion(right);
  for (const key of ['major', 'minor', 'patch'] as const) {
    if (a[key] < b[key]) return -1;
    if (a[key] > b[key]) return 1;
  }
  return 0;
}