const privateLine = '[パス・URLを含むログ行を省略]';
const payloadLine = '[画像・バイナリを含むログ行を省略]';

// Detection only: never return a decoded/normalized version of the original.
// Two common JSON/percent escaping layers, not arbitrary encoded payloads.
function inspectEscapes(line: string): string {
  for (let depth = 0; depth < 2; depth++) {
    line = line.replace(/\\(?:u([0-9a-f]{4})|x([0-9a-f]{2}))/gi,
      (_match, unicode: string | undefined, hex: string | undefined) => String.fromCharCode(Number.parseInt(unicode ?? hex!, 16)))
      .replace(/%([0-9a-f]{2})/gi, (_match, hex: string) => String.fromCharCode(Number.parseInt(hex, 16)));
  }
  return line;
}

/**
 * SEC-07A: best-effort masking for developer-authored log text, not UI/export data.
 * Omit entire lines containing paths/URLs so spaces/quotes in a username cannot
 * leave a suffix exposed. Fixed error codes on other lines remain readable.
 * Callers must exclude images, raw stderr, user text and arbitrary metadata at
 * source: no text heuristic can identify every opaque/base64 payload or secret.
 * No object/Error/binary coercion, filesystem, environment access or log output.
 */
export function redactLogText(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('ログのマスク対象は文字列だけです。');
  return value.split(/(\r\n|[\r\n\u2028\u2029])/u).map((line) => {
    const inspected = inspectEscapes(line);
    if (/data:|<svg\b|<img\b|[\0-\x08\x0b\x0c\x0e-\x1f]/iu.test(inspected)) return payloadLine;
    // Also mask URLs rather than trying to infer whether their path is private.
    if (/[a-z]:[\\/]|[\\/]{2}|file:|\\(?:\?\?|Device)\\/iu.test(inspected)) return privateLine;
    return line;
  }).join('');
}