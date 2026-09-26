# EXT-X1 観測 2 の preload（x1-probe.cjs）の写し

- 目的: `work/20260924-2230-EXT-X1-RootCause.md` の観測 2 を再現できるようにする。元の file は repository の外（session の作業 file）にあり、ここに内容を写した。製品の code ではない。
- 使い方（観測 2 と同じ形）: 下の code を `x1-probe.cjs` として保存し、`$env:X1_PROBE_LOG = <出力先の .jsonl>`、`$env:NODE_OPTIONS = '--require=C:/<path>/x1-probe.cjs'`（引用符で path を囲まない。区切りは `/`）としてから E2 の command（`work/20260924-0730-EXT-X1-Plan.md` §2）を実行する。

```js
// EXT-X1 observation only (not part of the repository): logs every mountvol probe's
// duration and outcome to show which branch of the volume check fires.
const cp = require('node:child_process');
const fs = require('node:fs');
const { threadId } = require('node:worker_threads');
const { syncBuiltinESMExports } = require('node:module');
const log = process.env.X1_PROBE_LOG;
const write = (o) => { try { fs.appendFileSync(log, JSON.stringify({ t: new Date().toISOString(), pid: process.pid, thread: threadId, ...o }) + '\n'); } catch {} };
const isMountvol = (file) => typeof file === 'string' && /mountvol\.exe$/i.test(file);
const realSpawnSync = cp.spawnSync;
cp.spawnSync = function (file, args, options) {
  if (!isMountvol(file)) return realSpawnSync.apply(this, arguments);
  const start = process.hrtime.bigint();
  const r = realSpawnSync.apply(this, arguments);
  write({ api: 'spawnSync', ms: Number(process.hrtime.bigint() - start) / 1e6, status: r.status, signal: r.signal, error: r.error && r.error.code, stderr: typeof r.stderr === 'string' ? r.stderr.length : null });
  return r;
};
const realExecFile = cp.execFile;
cp.execFile = function (file, args, options, callback) {
  if (!isMountvol(file) || typeof callback !== 'function') return realExecFile.apply(this, arguments);
  const start = process.hrtime.bigint();
  return realExecFile.call(this, file, args, options, (error, stdout, stderr) => {
    write({ api: 'execFile', ms: Number(process.hrtime.bigint() - start) / 1e6, error: error && (error.code ?? null), killed: error ? error.killed : null, signal: error ? error.signal : null, stderr: typeof stderr === 'string' ? stderr.length : null });
    callback(error, stdout, stderr);
  });
};
syncBuiltinESMExports();
```
