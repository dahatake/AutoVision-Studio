// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';

import { redactLogText } from './redact.js';

const pathMarker = '[パス・URLを含むログ行を省略]';
const payloadMarker = '[画像・バイナリを含むログ行を省略]';

describe('redactLogText (SEC-07A)', () => {
  it.each([
    'C:\\Users\\alice\\data\\photo.jpg', 'c:/Users/Alice/data/photo.jpg', 'D:\\移設profile\\山田 太郎\\画像.png',
    'C:\\Users\\O\'Connor\\data.jpg', 'C:\\Users\\利用者 🧪\\image.jpg', 'C:\\',
    '\\\\server\\share\\alice\\image.jpg', '//server/share/alice/image.jpg',
    '\\\\?\\C:\\Users\\alice\\data.jpg', '\\\\?\\UNC\\server\\share\\alice\\data.jpg',
    '\\??\\C:\\Users\\alice\\data.jpg', 'file:///C:/Users/alice/data.jpg', 'FILE://server/share/alice/data.jpg',
    'file:C:/Users/alice/data.jpg', 'read failed: "C:\\Users\\Alice Smith\\秘密.jpg" at line 1',
    "read failed: 'C:\\Users\\O'Connor\\secret.jpg'", 'from C:/Users/alice/a.jpg to D:/Profiles/bob/b.jpg',
    JSON.stringify({ path: 'C:\\Users\\alice\\data.jpg' }),
    'file:///C:/Users/%E5%B1%B1%E7%94%B0%20%E5%A4%AA%E9%83%8E/photo.jpg',
    '%43%3A%5CUsers%5Calice%5Cphoto.jpg', '%2543%253A%255CUsers%255Calice%255Cphoto.jpg',
    '\\u0043\\u003a\\u005cUsers\\u005calice\\u005cphoto.jpg', '\\x43\\x3a\\x5cUsers\\x5calice',
    '"\\u005c\\u005cserver\\share\\alice"', '%5C%5Cserver%5Cshare%5Calice',
    'https://example.test/alice/path', 'http://localhost/alice/path', 'wss://example.test/private',
    'prefixC:/Users/alice/data.jpg', '%43%3A%5CUsers%5Calice%ZZ',
    'READ_FAILED: \\??\\UNC\\server\\profiles\\山田 太郎\\画像.jpg',
    '\\Device\\HarddiskVolume3\\Users\\alice\\画像.jpg', '\\device\\Mup\\server\\share\\alice\\画像.jpg',
    '%5C%3F%3F%5CUNC%5Cserver%5Cprofiles%5Calice', '%255C%253F%253F%255CUNC%255Cserver%255Calice',
    '\\u005cDevice\\u005cHarddiskVolume3\\u005cUsers\\u005calice',
    '\\u005cu005cDevice\\u005cu005cHarddiskVolume3\\u005cu005cUsers\\u005cu005calice',
    '%5CDevice%5CHarddiskVolume3%5CUsers%5Calice', '%255CDevice%255CHarddiskVolume3%255CUsers%255Calice',
  ])('omits the complete path-bearing line %# without leaving private suffixes', (text) => {
    expect(redactLogText(text)).toBe(pathMarker);
    expect(redactLogText(redactLogText(text))).toBe(pathMarker);
  });

  it.each([
    'data:image/png;base64,PRIVATE_IMAGE_BYTES', 'DATA:IMAGE/JPEG;BASE64,PRIVATE_IMAGE_BYTES',
    'data:application/octet-stream;base64,PRIVATE_BINARY', 'prefix data:image/svg+xml,<svg>PRIVATE</svg>',
    '<svg xmlns="PRIVATE">PRIVATE</svg>', '<IMG SRC="PRIVATE_IMAGE">',
    '%64%61%74%61%3Aimage/png;base64,PRIVATE', '\\u0064ata:image/png;base64,PRIVATE',
    '\u0000PRIVATE_BINARY', '\u0001PRIVATE_BINARY', '\u001b[31mPRIVATE',
    'C:/Users/alice/image.png data:image/png;base64,PRIVATE',
  ])('omits a recognized image/binary representation %#', (text) => {
    expect(redactLogText(text)).toBe(payloadMarker);
    expect(redactLogText(redactLogText(text))).toBe(payloadMarker);
  });

  it.each([
    '', 'MAIN_STARTUP_FAILED', '画像を読み込めません。処理を停止しました。',
    '処理件数: 42 / 100', '12:30:59', 'version 1.2.3', 'availableBytes=0',
    '日本語 🧪・確認', '完了\tstatus=ok', '進捗 50%', '%ZZ', '\\uZZZZ',
    pathMarker, payloadMarker,
  ])('preserves permitted fixed diagnostic text %# exactly', (text) => {
    expect(redactLogText(text)).toBe(text);
  });

  it.each(['\n', '\r\n', '\r', '\u2028', '\u2029'])('preserves line separators %j and safe codes without path content', (separator) => {
    const text = `MAIN_STARTUP_FAILED${separator}read C:\\Users\\Alice Smith\\data.db${separator}${separator}再試行はしていません。${separator}`;
    const expected = `MAIN_STARTUP_FAILED${separator}${pathMarker}${separator}${separator}再試行はしていません。${separator}`;
    expect(redactLogText(text)).toBe(expected); expect(redactLogText(expected)).toBe(expected);
  });

  it('does not emit a partially decoded path when another escape is malformed', () => {
    expect(redactLogText('READ_FAILED\n%43%3A%5CUsers%5CAlice%ZZ\ncode=EACCES'))
      .toBe(`READ_FAILED\n${pathMarker}\ncode=EACCES`);
  });

  it.each([null, undefined, 123, false, {}, [], new Error('PRIVATE'), new String('PRIVATE'), Buffer.from('PRIVATE'), new Uint8Array([1, 2])])(
    'rejects non-text input %# without serialization', (value) => {
      expect(() => redactLogText(value)).toThrow('ログのマスク対象は文字列だけです。');
    },
  );

  it('does not call getters or custom stringification on rejected input', () => {
    const read = vi.fn(() => { throw new Error('PRIVATE_NATIVE_PATH'); });
    const input = { get message() { return read(); }, get stack() { return read(); }, toString: read, [Symbol.toPrimitive]: read };
    expect(() => redactLogText(input)).toThrow(TypeError); expect(read).not.toHaveBeenCalled();
  });

  it('does not claim to identify opaque encoded payloads: callers must exclude them at source', () => {
    const opaque = 'b3BhcXVlLWZpeHR1cmU=';
    expect(redactLogText(opaque)).toBe(opaque);
  });
});