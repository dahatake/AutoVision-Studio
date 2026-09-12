import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// UIR-066C / SEC-07C7 test-only leaf.
// Native Node24.19.x launcher; actual dist entry, no fixture API or build/download.
const self = fileURLToPath(import.meta.url), root = realpathSync(resolve(dirname(self), '../..'));
const require = createRequire(import.meta.url), main = join(root, 'dist/main/index.js');
const rendererUrl = pathToFileURL(join(root, 'dist/renderer/index.html')).href;
const runPattern = /^ui-diagnostics-integration-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const samePath = (a, b) => typeof a === 'string' && resolve(a).toLowerCase() === resolve(b).toLowerCase();
const reason = (error) => String(error?.message ?? '').match(/^(?:Error: )?([A-Z][A-Z0-9_]{0,95})(?:\r?\n|$)/)?.[1] ?? 'UNEXPECTED_FAILURE';
function owned(output, name) {
  const path = resolve(output, name), local = relative(output, path);
  assert.ok(local && !isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`), 'OUTPUT_ESCAPE');
  let cursor = output;
  for (const part of ['', ...local.split(sep)]) {
    cursor = join(cursor, part);
    try { const stat = lstatSync(cursor); assert.ok(!stat.isSymbolicLink() && (stat.isDirectory() || (stat.isFile() && stat.nlink === 1)), 'OUTPUT_LINK'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return path;
}
function put(output, name, data) {
  const path = owned(output, name), bytes = JSON.stringify(data, null, 2);
  assert.ok(Buffer.byteLength(bytes) < 4 * 1024 * 1024, 'EVIDENCE_LIMIT');
  writeFileSync(path, bytes, { flag: existsSync(path) ? 'w' : 'wx' });
}
const get = (output, name) => JSON.parse(readFileSync(owned(output, name), 'utf8'));
function hashes() {
  const files = ['package.json', 'package-lock.json', 'src/main/index.ts', 'src/main/diagnostics/diagnostics-service.ts',
    // Startup uses these shared Core dependencies even when this run creates no
    // Project. Pin their source too, rather than relying on the entry hash alone.
    'src/main/projects/project-directory.ts', 'src/main/projects/project-move.ts', 'src/main/projects/project-move-receipt.ts',
    'src/main/projects/project-repository.ts', 'src/main/projects/project-service.ts', 'src/main/ipc/project-handlers.ts',
    'src/main/db/database.ts', 'src/main/db/backup.ts', 'src/main/db/migrate.ts',
    'src/main/db/migrations/001_core.sql', 'src/main/db/migrations/002_jobs.sql',
    'src/main/ipc/diagnostics-handlers.ts', 'src/preload/index.ts', 'src/preload/diagnostics-api.ts',
    'src/main/logging/diagnostic-export.ts', 'src/shared/contracts/diagnostic-export.ts', 'src/shared/contracts/app.ts',
    'src/shared/contracts/diagnostics.ts', 'src/renderer/layout/AppShell.tsx', 'src/renderer/features/settings/SettingsPage.tsx',
    'src/renderer/features/settings/SettingsPage.css',
    'src/renderer/features/diagnostics/DiagnosticsPage.tsx', 'src/renderer/features/diagnostics/DiagnosticsPage.css',
    'src/renderer/styles/global.css', 'src/renderer/styles/tokens.css', 'ml/src/autovision_ml/cli.py',
    'ml/src/autovision_ml/commands/probe_hardware.py', 'ml/pyproject.toml', 'ml/uv.lock',
    'tests/manual/ui-diagnostics-integration-probe.mjs'];
  for (const dir of ['dist/main', 'dist/preload', 'dist/renderer', 'dist/renderer/assets']) {
    const entries = readdirSync(join(root, dir)); assert.ok(entries.length > 0 && entries.length < 64, 'BUNDLE_LIMIT');
    for (const name of entries) {
      if (dir === 'dist/renderer' && name === 'assets') continue;
      const stat = lstatSync(join(root, dir, name)); assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'BUNDLE_ENTRY');
      files.push(`${dir}/${name}`);
    }
  }
  return Object.fromEntries(files.sort().map((file) => [file, sha(readFileSync(join(root, file)))]));
}
function readView() {
  const q = (s) => document.querySelector(s), shown = (e) => e && !e.closest('[hidden]') && e.getClientRects().length > 0;
  const page = q('.diagnostics-page'), summary = q('section[aria-label="端末診断"]');
  return { headings: [...document.querySelectorAll('main h1')].filter(shown).map((e) => e.textContent.trim()),
    list: q('.project-list-page [role=status]')?.textContent, zero: document.body.textContent.includes('Project は0件です。'),
    summary: shown(summary) ? summary.textContent : null, diagnostic: summary?.querySelector('[role=status]')?.textContent,
    detail: shown(page) ? page.querySelector('[role=status]')?.textContent : null,
    exportStatus: shown(page) ? page.querySelector('[aria-label="診断要約の保存状態"]')?.textContent : null,
    footer: q('.app-shell__footer')?.textContent, focus: document.activeElement?.id,
    createEnabled: q('.project-list-page__toolbar > button:first-of-type')?.disabled === false,
    selected: page?.querySelector('[role=tab][aria-selected=true]')?.textContent,
    search: q('input[type=search]')?.value,
    rows: page ? [...page.querySelectorAll('[role=tabpanel]:not([hidden]) dl > div')].map((e) => [e.querySelector('dt')?.textContent, e.querySelector('dd')?.textContent]) : [],
    noMedia: document.querySelector('video,audio,iframe,canvas') === null };
}

// Layout facts are independent of IPC success. No style/DOM text changes are made.
async function measure(reflow, selector = '.app-shell') {
  const html = document.documentElement, body = document.body, frame = () => new Promise((done) => requestAnimationFrame(done));
  const scope = document.querySelector(selector);
  const visible = (e) => e.getClientRects().length > 0 && !e.closest('[hidden],svg,.skip-link') && getComputedStyle(e).visibility === 'visible';
  const fits = (r) => r.x >= -1 && r.y >= -1 && r.right <= html.clientWidth + 1 && r.bottom <= innerHeight + 1 && r.width > 0 && r.height > 0;
  const clipped = (e, r) => {
    for (let p = e; p && p !== body; p = p.parentElement) {
      const s = getComputedStyle(p), b = p.getBoundingClientRect(), x = b.x + p.clientLeft, y = b.y + p.clientTop;
      if ((s.overflowX !== 'visible' && (r.x < x - 1 || r.right > x + p.clientWidth + 1))
        || (s.overflowY !== 'visible' && (r.y < y - 1 || r.bottom > y + p.clientHeight + 1))) return true;
    }
    return false;
  };
  const reachable = (e, r) => { const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
    return fits(r) && !clipped(e, r) && (target === e || e.contains(target)); };
  const reveal = async (r) => { if (reflow) { window.scrollBy({ top: r.y + r.height / 2 - innerHeight / 2, left: 0, behavior: 'instant' }); await frame(); } };
  const result = { scope: selector, viewport: [innerWidth, innerHeight], document: [html.scrollWidth, html.scrollHeight],
    initialScroll: [scrollX, scrollY], dark: matchMedia('(prefers-color-scheme: dark)').matches, controls: [],
    textFragments: 0, textUnreachable: 0, examples: [], localOverflow: [] };
  result.boxes = [...document.querySelectorAll('.app-shell__header,.app-shell__main,.app-shell__footer,.settings-page,.settings-page__header,.settings-page__category-navigation,.settings-page__content,#settings-category-heading,.diagnostics-page,.diagnostics-page__header,.diagnostics-page__toolbar,.diagnostics-page__tabs,.diagnostics-page__grid,.diagnostics-page__card,.diagnostics-page h2,.diagnostics-page p')]
    .filter(visible).map((e) => { const s = getComputedStyle(e); return { tag: e.tagName, className: e.className, id: e.id,
      rect: e.getBoundingClientRect().toJSON(), margin: s.margin, padding: s.padding, gap: s.gap, fontSize: s.fontSize, lineHeight: s.lineHeight }; });
  for (const e of [...scope.querySelectorAll('button,input,a')].filter(visible)) {
    let r = e.getBoundingClientRect(); if (!reachable(e, r)) { await reveal(r); r = e.getBoundingClientRect(); }
    result.controls.push({ label: e.getAttribute('aria-label') || e.textContent.trim(), reachable: reachable(e, r),
      rect: r.toJSON(), scroll: [scrollX, scrollY], disabled: e.matches(':disabled') });
  }
  for (const e of [...scope.querySelectorAll('*')].filter(visible)) {
    if (e.clientWidth > 0 && e.clientHeight > 0 && (e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)) {
      result.localOverflow.push({ tag: e.tagName, className: e.className, x: e.scrollWidth > e.clientWidth + 1, y: e.scrollHeight > e.clientHeight + 1 });
    }
  }
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const e = node.parentElement; if (!node.textContent.trim() || !visible(e)) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    for (let i = 0; i < range.getClientRects().length; i++) {
      let r = range.getClientRects()[i]; if (!reachable(e, r)) { await reveal(r); r = range.getClientRects()[i]; }
      result.textFragments++;
      if (!reachable(e, r) || scrollX !== 0) { result.textUnreachable++; if (result.examples.length < 12) result.examples.push({ tag: e.tagName, rect: r.toJSON() }); }
    }
  }
  if (reflow) { window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); await frame(); }
  result.finalScroll = [scrollX, scrollY];
  result.pass = result.document[0] <= html.clientWidth + 1 && result.textFragments > 0 && result.textUnreachable === 0
    && result.controls.every((c) => c.reachable && c.scroll[0] === 0) && result.localOverflow.every((e) => !e.x && (reflow || !e.y))
    && (reflow || (result.document[1] <= innerHeight + 1 && result.initialScroll.every((n) => n === 0) && result.finalScroll.every((n) => n === 0)));
  return result;
}

async function inspect(output, deadline) {
  const { app, dialog, ipcMain, nativeTheme, session } = require('electron');
  assert.ok(process.connected && !app.isReady() && samePath(dirname(output), join(root, 'test-results')) && runPattern.test(basename(output)), 'LAUNCHER_REQUIRED');
  assert.ok(get(output, 'owner.json').deadline === deadline && deadline > Date.now(), 'DEADLINE_INVALID');
  app.setName(basename(output));
  for (const name of ['userData', 'sessionData', 'crashDumps']) app.setPath(name, owned(output, name));
  app.setAppLogsPath(owned(output, 'logs'));
  for (const name of ['disable-background-networking', 'disable-component-update']) app.commandLine.appendSwitch(name);
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
  const report = { status: 'RUNNING', runtime: process.versions, cases: [], calls: [], workers: [], screens: [], failures: [],
    prompts: [], exports: [], fullPathPages: [],
    guards: { permissionChecks: 0, permissionRequests: 0, requests: 0, rendererErrors: 0, mediaPlayback: 0, dialogs: 0 }, gracefulWillQuit: false };
  const activeWorkers = new Set(), workerCloses = [], persist = () => put(output, 'electron.json', report);
  let closing = false, forced, expectedPrompt = null, pendingPrompt = null;
  const finish = (error) => {
    if (error) {
      report.failures.push(reason(error));
      report.failureLocation = String(error.stack ?? '').match(/ui-diagnostics-integration-probe\.mjs:\d+:\d+/)?.[0] ?? null;
      report.failureType = /^[A-Za-z]+Error$/.test(error.name ?? '') ? error.name : 'Error';
    }
    if (closing) { report.status = 'FAIL'; persist(); return; }
    closing = true; clearTimeout(watchdog);
    pendingPrompt?.respond(0, 'TEST_STOP');
    for (const item of report.cases) if (item.status === 'RUNNING') item.status = 'FAIL';
    report.status = report.failures.length || report.cases.length !== 9 || report.cases.some((c) => c.status !== 'PASS')
      || report.prompts.length !== 2 || report.exports.length !== 1 || report.fullPathPages.length === 0
      || report.screens.length !== 19 + report.fullPathPages.length ? 'FAIL'
      : report.screens.every((s) => s.metrics.pass) ? 'PASS' : 'FAIL_LAYOUT';
    forced = setTimeout(() => {
      report.status = 'FAIL'; report.failures.push('FORCED_SELF_EXIT');
      for (const child of activeWorkers) if (child.exitCode === null && child.signalCode === null) child.kill();
      persist(); app.exit(1);
    }, 2000);
    persist(); app.quit();
  };
  const watchdog = setTimeout(() => finish(new Error('CHILD_DEADLINE')), Math.max(1, deadline - Date.now() - 5000));
  process.on('message', (m) => { if (m === 'stop') finish(new Error('PARENT_STOP')); });
  process.on('uncaughtException', finish); process.on('unhandledRejection', finish);
  app.once('will-quit', () => { report.gracefulWillQuit = true;
    if (!closing || activeWorkers.size || Object.entries(report.guards).some(([k, n]) => k !== 'permissionChecks' && n !== 0)) {
      report.status = 'FAIL'; report.failures.push('SHUTDOWN_OR_GUARD_FAILURE');
    }
    persist(); clearTimeout(forced); clearTimeout(watchdog);
  });
  dialog.showErrorBox = () => { report.guards.dialogs++; finish(new Error('MAIN_ERROR_BOX')); };
  dialog.showOpenDialog = async () => { report.guards.dialogs++; finish(new Error('UNEXPECTED_PICKER')); return { canceled: true, filePaths: [] }; };
  dialog.showMessageBoxSync = () => { report.guards.dialogs++; finish(new Error('UNEXPECTED_DIALOG')); return 0; };
  // Explicit test double for user decisions, NOT evidence of native dialog
  // rendering or human consent. All downstream Main/worker/file code is real.
  dialog.showMessageBox = (window, options) => {
    try {
      assert.ok(expectedPrompt && !pendingPrompt && !closing, 'UNEXPECTED_EXPORT_PROMPT');
      assert.equal(window.webContents.getURL(), rendererUrl, 'EXPORT_PROMPT_OWNER');
      assert.deepEqual(options.buttons, ['キャンセル', '保存'], 'EXPORT_PROMPT_BUTTONS');
      assert.ok(options.defaultId === 0 && options.cancelId === 0 && options.noLink === true, 'EXPORT_DEFAULT_CANCEL');
      assert.equal(options.title, '診断要約の保存', 'EXPORT_PROMPT_TITLE');
      assert.ok(options.signal instanceof AbortSignal && !options.signal.aborted && typeof options.detail === 'string', 'EXPORT_PROMPT_INVALID');
      const item = { title: options.title, message: options.message, detail: options.detail, buttons: options.buttons,
        defaultId: options.defaultId, cancelId: options.cancelId, ownerChecked: true, status: 'WAITING' };
      report.prompts.push(item);
      const completion = Promise.withResolvers();
      let responded = false;
      const abort = () => respond(0, 'ABORTED');
      const respond = (response, status = 'TEST_RESPONSE') => {
        if (responded) return;
        responded = true; item.response = response; item.status = status;
        options.signal.removeEventListener('abort', abort); pendingPrompt = null;
        completion.resolve({ response, checkboxChecked: false });
      };
      pendingPrompt = { item, respond }; options.signal.addEventListener('abort', abort, { once: true });
      const waiting = expectedPrompt; expectedPrompt = null; waiting.resolve(pendingPrompt);
      persist(); return completion.promise;
    } catch (error) { report.guards.dialogs++; finish(error); return Promise.resolve({ response: 0, checkboxChecked: false }); }
  };
  // Observe and return the original Promise. Do not replace sender, arguments or results.
  const nativeHandle = ipcMain.handle;
  ipcMain.handle = function (channel, listener) {
    return nativeHandle.call(this, channel, function (event, ...args) {
      if (report.calls.length >= 32) { finish(new Error('IPC_COUNT_LIMIT')); throw new Error('IPC_COUNT_LIMIT'); }
      const item = { channel, argsCount: args.length, startedAt: Date.now(), mainFrame: event.senderFrame === event.sender.mainFrame,
        expectedUrl: event.sender.getURL() === rendererUrl, status: 'RUNNING' }; report.calls.push(item);
      let result;
      try { result = listener.call(this, event, ...args); }
      catch (error) { item.status = 'REJECTED'; throw error; }
      void Promise.resolve(result).then((value) => {
        item.status = 'RESOLVED'; item.finishedAt = Date.now();
        if (channel === 'diagnostics:collect' || channel === 'diagnostics:export') {
          const bytes = JSON.stringify(value); assert.ok(Buffer.byteLength(bytes) <= 256 * 1024, 'REPORT_LIMIT');
          item.response = JSON.parse(bytes); item.responseSha256 = sha(bytes);
        } else if (channel === 'project:list') item.count = value?.ok === true ? value.value.length : null;
      }, () => { item.status = 'REJECTED'; item.finishedAt = Date.now(); }).catch(finish);
      return result;
    });
  };
  const nativeExec = childProcess.execFile;
  childProcess.execFile = function (...args) {
    const [executable, argv, options] = args;
    const item = { executable, args: argv, cwd: options?.cwd, shell: options?.shell, timeout: options?.timeout, startedAt: Date.now(), closed: false };
    report.workers.push(item);
    const child = nativeExec.apply(this, args); item.pid = child.pid; activeWorkers.add(child);
    const hash = createHash('sha256'), chunks = []; item.stdoutBytes = 0; item.stderrBytes = 0;
    child.stdout?.on('data', (data) => {
      item.stdoutBytes += Buffer.byteLength(data); hash.update(data);
      if (item.stdoutBytes <= 256 * 1024) chunks.push(Buffer.from(data));
      else finish(new Error('WORKER_STDOUT_LIMIT'));
    });
    child.stderr?.on('data', (data) => { item.stderrBytes += Buffer.byteLength(data); });
    workerCloses.push(new Promise((done) => child.once('close', (code, signal) => {
      item.exitCode = code; item.signal = signal; item.closed = true; item.finishedAt = Date.now(); item.stdoutSha256 = hash.digest('hex');
      try { item.observations = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { item.invalidJson = true; }
      activeWorkers.delete(child); done();
    })));
    return child;
  };
  const step = async (name, action) => { const item = { name, status: 'RUNNING', startedAt: Date.now() }; report.cases.push(item); report.lastAction = name; persist();
    try { await action(); assert.equal(closing, false, 'INSPECTION_STOPPED'); item.status = 'PASS'; }
    finally { item.finishedAt = Date.now(); persist(); } };
  try {
    await app.whenReady(); nativeTheme.themeSource = 'light';
    session.defaultSession.setPermissionCheckHandler(() => { report.guards.permissionChecks++; return false; });
    session.defaultSession.setPermissionRequestHandler((_wc, _permission, callback) => { report.guards.permissionRequests++; callback(false); });
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      let allowed = false;
      try { const local = relative(join(root, 'dist/renderer'), fileURLToPath(details.url));
        allowed = !!local && !isAbsolute(local) && local !== '..' && !local.startsWith(`..${sep}`); } catch { /* deny */ }
      if (!allowed) report.guards.requests++; callback({ cancel: !allowed });
    });
    const loaded = new Promise((done) => app.once('browser-window-created', (_event, window) => {
      const wc = window.webContents;
      wc.once('did-finish-load', () => done(window)); wc.on('did-fail-load', () => finish(new Error('LOAD_FAILED')));
      wc.on('preload-error', () => finish(new Error('PRELOAD_FAILED'))); wc.on('render-process-gone', () => { if (!closing) finish(new Error('RENDERER_GONE')); });
      wc.on('console-message', (details) => { if (details.level === 'error') report.guards.rendererErrors++; });
      wc.on('media-started-playing', () => { report.guards.mediaPlayback++; });
    }));
    await import(pathToFileURL(main).href);
    const window = await loaded, wc = window.webContents;
    assert.equal(wc.getURL(), rendererUrl, 'WRONG_RENDERER'); assert.equal(app.isPackaged, false, 'DEVELOPMENT_ENTRY_REQUIRED');
    const js = (fn, ...args) => wc.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);
    const settle = () => js(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const ready = async (predicate) => {
      const state = await wc.executeJavaScript(`new Promise((resolve,reject)=>{
        const read=${readView.toString()}, test=${predicate.toString()};
        const observer=new MutationObserver(check); const timer=setTimeout(()=>{observer.disconnect();reject(new Error('UI_READY_TIMEOUT'));},35000);
        function check(){const state=read();if(test(state)){clearTimeout(timer);observer.disconnect();resolve(state);}}
        observer.observe(document.body,{childList:true,subtree:true,attributes:true,characterData:true});check();})`);
      report.lastView = state; await settle(); return state;
    };
    const click = async (selector) => {
      report.lastAction = `click:${selector}`;
      window.show(); window.focus(); wc.focus();
      await js((s) => { const e = document.querySelector(s); if (!e || e.closest('[hidden]')) throw new Error('TARGET_MISSING');
        e.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); }, selector); await settle();
      const point = await js((s) => { const e = document.querySelector(s), r = e.getBoundingClientRect(), x = Math.floor(r.x + r.width / 2), y = Math.floor(r.y + r.height / 2), hit = document.elementFromPoint(x, y);
        return { x, y, reachable: document.hasFocus() && !e.matches(':disabled') && r.width > 0 && r.height > 0 && r.x >= 0 && r.y >= 0
          && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && (hit === e || e.contains(hit)) }; }, selector);
      assert.ok(point.reachable, 'NATIVE_TARGET_UNREACHABLE');
      const zoom = wc.getZoomFactor(), x = Math.round(point.x * zoom), y = Math.round(point.y * zoom);
      report.lastInput = { selector, css: point, zoom, native: { x, y } };
      for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) wc.sendInputEvent({ type, x, y, button: 'left', clickCount: 1 });
      await settle();
    };
    const diagnostics = () => report.calls.filter((c) => c.channel === 'diagnostics:collect');
    const current = () => { const call = diagnostics().at(-1); assert.equal(call?.status, 'RESOLVED', 'DIAGNOSTIC_NOT_RESOLVED');
      assert.ok(['ok', 'partial'].includes(call.response.status), 'REAL_DIAGNOSTICS_UNAVAILABLE'); return call.response; };
    const capacity = (r) => `アプリデータ（userData）ボリュームの空き：${r.disk.data ? `${r.disk.data.freeBytes.toLocaleString('ja-JP')} B` : '未取得'}（Project 使用量ではありません）`;
    const verifySummary = async () => { const state = await js(readView), response = current();
      assert.ok(state.summary.includes(capacity(response)) && state.footer.includes(capacity(response)), 'CAPACITY_RESPONSE_MISMATCH');
      assert.ok(state.createEnabled && state.noMedia && !/CPU可|CPU 動作可|推奨構成/.test(state.summary), 'UNSUPPORTED_CAPABILITY_CLAIM');
      report.lastView = state;
    };
    const capture = async (name, reflow, selector) => {
      report.lastAction = `capture:${name}`;
      // Start each layout measurement at the top. The metric still rejects all
      // normal-height overflow; input scrolling is not a no-scroll PASS.
      await js(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' })); await settle();
      const item = { name, metrics: await js(measure, reflow, selector ?? '.app-shell'), stable: false }; report.screens.push(item);
      let png, previous;
      for (let i = 0; i < 8; i++) { wc.invalidate(); await settle(); const image = await wc.capturePage(); assert.equal(image.isEmpty(), false, 'EMPTY_CAPTURE');
        png = image.toPNG(); const hash = sha(png); if (hash === previous) { item.stable = true; break; } previous = hash; }
      item.file = `${name}.png`; item.sha256 = sha(png); writeFileSync(owned(output, item.file), png, { flag: 'wx' });
      assert.ok(item.stable && sha(readFileSync(owned(output, item.file))) === item.sha256, 'CAPTURE_UNSTABLE'); persist();
    };
    window.setContentSize(1280, 640); wc.setZoomFactor(1); window.show(); window.focus(); wc.focus(); await settle();
    await step('initial-zero-project-diagnostic', async () => {
      await ready((s) => s.list === '取得済み' && /^(取得済み|一部未取得)$/.test(s.diagnostic));
      assert.equal(diagnostics().length, 1, 'INITIAL_COLLECT_COUNT'); assert.ok((await js(readView)).zero, 'PROFILE_NOT_EMPTY');
      await verifySummary(); await capture('initial-list', false);
    });
    await step('detail-through-real-ipc', async () => {
      await click('#diagnostics-settings-link'); await ready((s) => /^(取得済み|一部未取得)$/.test(s.detail));
      assert.equal(diagnostics().length, 2, 'DETAIL_MUST_RECOLLECT'); const response = current(), state = await js(readView);
      assert.deepEqual(state.headings, ['端末・容量'], 'DETAIL_HEADING'); assert.equal(state.focus, 'settings-heading', 'DETAIL_FOCUS');
      const cell = (label) => state.rows.find(([name]) => name === label)?.[1];
      if (response.cpu.data?.logicalCount != null) assert.equal(cell('論理プロセッサ数'), String(response.cpu.data.logicalCount), 'CPU_RESPONSE_MISMATCH');
      if (response.disk.data) assert.equal(cell('空き'), `${response.disk.data.freeBytes.toLocaleString('ja-JP')} B`, 'DETAIL_DISK_MISMATCH');
      assert.ok(state.footer.includes(capacity(response)), 'DETAIL_FOOTER_MISMATCH');
    });
    await step('diagnostic-viewports-and-native-tabs', async () => {
      for (const [width, height, zoom, theme] of [[1280, 640, 1, 'light'], [1280, 640, 1, 'dark'], [1280, 640, 2, 'light'], [1024, 600, 1, 'light']]) {
        window.setContentSize(width, height); wc.setZoomFactor(zoom); nativeTheme.themeSource = theme; await settle();
        for (const index of [0, 1]) {
          await click(`.diagnostics-page [role=tab][id$="-tab-${index}"]`);
          assert.equal((await js(readView)).selected, index ? '実行環境' : '端末', 'NATIVE_TAB_NOT_SELECTED');
          await capture(`${theme}-${width}x${height}-z${zoom}-${index}`, zoom !== 1 || width < 1280);
          const metric = report.screens.at(-1).metrics;
          assert.ok(Math.abs(metric.viewport[0] - width / zoom) <= 1 && Math.abs(metric.viewport[1] - height / zoom) <= 1 && metric.dark === (theme === 'dark'), 'VIEWPORT_MISMATCH');
        }
      }
      assert.equal(diagnostics().length, 2, 'TABS_MUST_NOT_COLLECT');
      assert.ok(await js(() => document.querySelector('[aria-label="カメラ"]')?.textContent.includes('未取得 — 推論開始時に確認します。')), 'CAMERA_NOT_DEFERRED');
      window.setContentSize(1280, 640); wc.setZoomFactor(1); nativeTheme.themeSource = 'light'; await settle();
    });
    const exportCalls = () => report.calls.filter((c) => c.channel === 'diagnostics:export');
    const logFiles = () => readdirSync(owned(output, 'userData/logs'));
    const exportSelector = '.diagnostics-page__toolbar > button:last-of-type';
    const askToExport = async () => {
      assert.ok(!expectedPrompt && !pendingPrompt, 'PROMPT_ALREADY_PENDING');
      expectedPrompt = Promise.withResolvers(); const waiting = expectedPrompt.promise;
      await click(exportSelector);
      const prompt = await waiting;
      assert.ok((await js(readView)).exportStatus.includes('確認待ち'), 'EXPORT_NOT_PENDING');
      return prompt;
    };
    await step('cancel-summary-without-files', async () => {
      assert.equal(exportCalls().length, 0, 'EXPORT_MUST_BE_EXPLICIT'); assert.deepEqual(logFiles(), [], 'AUTO_EXPORTED');
      const prompt = await askToExport(); assert.deepEqual(logFiles(), [], 'WROTE_BEFORE_CONFIRMATION');
      prompt.respond(0);
      await ready((s) => s.exportStatus?.includes('保存をキャンセルしました'));
      assert.deepEqual(exportCalls().at(-1).response, { status: 'cancelled' }, 'CANCEL_RESULT');
      assert.deepEqual(logFiles(), [], 'CANCEL_CREATED_FILE'); await capture('summary-cancelled', false);
    });
    await step('save-confirmed-summary-through-real-worker', async () => {
      const prompt = await askToExport(); assert.deepEqual(logFiles(), [], 'WROTE_BEFORE_CONFIRMATION');
      prompt.respond(1); await ready((s) => s.exportStatus === '診断要約を保存しました。');
      const result = exportCalls().at(-1).response;
      assert.deepEqual(Object.keys(result).sort(), ['byteLength', 'path', 'sha256', 'status'], 'EXPORT_RESULT_FIELDS');
      assert.ok(result.status === 'saved' && samePath(dirname(result.path), owned(output, 'userData/logs'))
        && /^diagnostics-[0-9a-f-]{36}\.txt$/.test(basename(result.path)), 'EXPORT_DESTINATION');
      const file = relative(output, result.path), bytes = readFileSync(owned(output, file)), text = bytes.toString('utf8');
      assert.deepEqual(logFiles(), [basename(result.path)], 'EXTRA_EXPORT_FILES');
      assert.ok(bytes.length === result.byteLength && sha(bytes) === result.sha256, 'EXPORT_CONTENT_HASH');
      assert.equal(prompt.item.detail, `${text}\n保存先: ${result.path}`, 'PREVIEW_SAVE_MISMATCH');
      assert.ok(!text.includes(root) && !text.includes(output) && !/data:image|base64,/.test(text), 'EXPORT_PRIVATE_TEXT');
      await Promise.all(workerCloses);
      const observations = report.workers.at(-1).observations;
      assert.ok(['ok', 'partial'].includes(observations?.status), 'EXPORT_DIAGNOSTIC_UNAVAILABLE');
      if (observations.cpu.data?.logicalCount != null) assert.ok(text.includes(`論理プロセッサ ${observations.cpu.data.logicalCount}`), 'EXPORT_CPU_MISMATCH');
      if (observations.disk.data) assert.ok(text.includes(`空き ${observations.disk.data.freeBytes} B`), 'EXPORT_DISK_MISMATCH');
      assert.equal(diagnostics().length, 2, 'EXPORT_MUST_NOT_REPLACE_DISPLAY_COLLECTION');
      assert.equal(exportCalls().length, 2, 'EXPORT_CALL_COUNT');
      report.exports.push({ file, byteLength: bytes.length, sha256: sha(bytes), previewMatched: true, workerIndex: report.workers.length - 1 });
    });
    await step('saved-summary-viewports', async () => {
      for (const [width, height, zoom, theme] of [[1280, 640, 1, 'light'], [1280, 640, 1, 'dark'], [1280, 640, 2, 'light'], [1024, 600, 1, 'light']]) {
        window.setContentSize(width, height); wc.setZoomFactor(zoom); nativeTheme.themeSource = theme; await settle();
        for (const index of [0, 1]) {
          await click(`.diagnostics-page [role=tab][id$="-tab-${index}"]`);
          assert.equal((await js(readView)).selected, index ? '実行環境' : '端末', 'NATIVE_TAB_NOT_SELECTED');
          await capture(`saved-${theme}-${width}x${height}-z${zoom}-${index}`, zoom !== 1 || width < 1280);
          const metric = report.screens.at(-1).metrics;
          assert.ok(Math.abs(metric.viewport[0] - width / zoom) <= 1 && Math.abs(metric.viewport[1] - height / zoom) <= 1
            && metric.dark === (theme === 'dark'), 'VIEWPORT_MISMATCH');
        }
      }
      window.setContentSize(1280, 640); wc.setZoomFactor(1); nativeTheme.themeSource = 'light'; await settle();
      assert.equal(exportCalls().length, 2, 'VIEWPORT_MUST_NOT_EXPORT');
    });
    await step('full-saved-path-and-native-escape', async () => {
      await click('button[aria-label="診断要約の保存先を表示"]');
      const pages = await js(() => Number(document.querySelector('.diagnostics-page__value-dialog nav span')?.textContent.split('/')[1]));
      assert.ok(Number.isInteger(pages) && pages > 0 && pages <= 300, 'EXPORT_PATH_PAGES');
      for (let page = 0; page < pages; page++) {
        const text = await js(() => document.querySelector('dialog[open] .diagnostics-page__full-value')?.textContent);
        assert.ok(typeof text === 'string' && text.length > 0, 'EXPORT_PATH_EMPTY');
        report.fullPathPages.push(text); await capture(`export-path-${page + 1}`, false, '.diagnostics-page__value-dialog');
        if (page + 1 < pages) await click('button[aria-label="全文: 次のページ"]');
      }
      assert.equal(report.fullPathPages.join(''), exportCalls().at(-1).response.path, 'EXPORT_PATH_INCOMPLETE');
      for (const type of ['keyDown', 'keyUp']) wc.sendInputEvent({ type, keyCode: 'ESC' });
      await settle();
      assert.ok(await js(() => !document.querySelector('dialog[open]')
        && document.activeElement?.getAttribute('aria-label') === '診断要約の保存先を表示'), 'EXPORT_PATH_ESCAPE_FOCUS');
      assert.equal(exportCalls().length, 2, 'PATH_INSPECTION_MUST_NOT_EXPORT');
    });
    await step('return-and-explicit-refresh', async () => {
      await click('.diagnostics-page__header button'); await ready((s) => s.list === '取得済み' && s.detail === null);
      assert.equal((await js(readView)).focus, 'diagnostics-settings-link', 'RETURN_FOCUS'); await verifySummary();
      await click('section[aria-label="端末診断"] > button');
      await ready((s) => /^(取得済み|一部未取得)$/.test(s.diagnostic));
      assert.equal(diagnostics().length, 3, 'REFRESH_MUST_RECOLLECT'); await verifySummary(); await capture('refreshed-list', false);
    });
    await step('creation-entry-without-mutation-and-worker-exit', async () => {
      await click('.project-list-page__toolbar > button:first-of-type'); await ready((s) => s.headings.includes('Project を作成'));
      assert.ok(await js(() => { const e = document.querySelector('.project-form__name input'); return e && !e.disabled; }), 'CREATE_INPUT_DISABLED');
      await Promise.all(workerCloses); assert.equal(activeWorkers.size, 0, 'WORKER_EXIT_NOT_CONFIRMED');
      const operations = report.calls.filter((c) => c.channel === 'diagnostics:collect' || c.channel === 'diagnostics:export');
      assert.equal(report.workers.length, 5, 'WORKER_COUNT'); assert.equal(operations.length, 5, 'DIAGNOSTIC_OPERATION_COUNT');
      for (const [i, worker] of report.workers.entries()) {
        assert.ok(samePath(worker.executable, join(root, 'ml/.venv/Scripts/python.exe')) && samePath(worker.cwd, join(root, 'ml')), 'WORKER_PATH_CHANGED');
        assert.deepEqual(worker.args, ['-m', 'autovision_ml.cli', 'probe-hardware', '--disk-path', owned(output, 'userData')], 'WORKER_ARGUMENTS_CHANGED');
        assert.ok(worker.closed && !worker.invalidJson && ['ok', 'partial'].includes(worker.observations?.status)
          && worker.signal === null && worker.exitCode === (worker.observations.status === 'ok' ? 0 : 1)
          && worker.startedAt >= operations[i].startedAt && worker.startedAt <= operations[i].finishedAt
          && worker.stderrBytes === 0 && worker.stdoutBytes > 0 && worker.shell === false && worker.timeout === 30000, 'WORKER_DID_NOT_COMPLETE');
      }
      assert.ok(report.calls.every((c) => ['project:list', 'diagnostics:collect', 'diagnostics:export'].includes(c.channel) && c.argsCount === 0
        && c.mainFrame && c.expectedUrl && c.status === 'RESOLVED' && (c.channel !== 'project:list' || c.count === 0)), 'UNEXPECTED_IPC_MUTATION');
    });
    finish();
  } catch (error) { finish(error); }
}

async function launch() {
  assert.ok(!process.versions.electron && process.platform === 'win32' && process.arch === 'x64' && /^24\.19\.\d+$/.test(process.versions.node), 'NATIVE_NODE_24_19_REQUIRED');
  const results = join(root, 'test-results'); assert.ok(lstatSync(results).isDirectory() && !lstatSync(results).isSymbolicLink(), 'RESULTS_LINK');
  const output = join(results, `ui-diagnostics-integration-${randomUUID()}`); mkdirSync(output);
  for (const dir of ['userData', 'sessionData', 'crashDumps', 'logs', 'temp', 'appData', 'localAppData']) mkdirSync(owned(output, dir));
  const started = Date.now(), deadline = started + 180000, before = hashes(), electron = realpathSync(require('electron'));
  put(output, 'owner.json', { deadline, runId: basename(output) });
  const result = { status: 'RUNNING', scope: 'UIR066C/SEC07C7 actual-dist diagnostic/export integration; test dialog decisions, not release or user acceptance', startedAt: new Date(started).toISOString(),
    hashesBefore: before, failures: [], overrides: ['isolated profile/temp/appData', 'network/permissions denied in test session',
      'native export confirmation uses explicit cancel/save test responses; other dialogs stop test',
      'ipcMain.handle / child_process.execFile observation-only wrappers', 'PYTHONDONTWRITEBYTECODE=1', 'explicit size/zoom/theme'],
    notTested: ['PRE-03/CORE-13A/UIN-04 overall', 'Narrator/user confirmation', 'packaged app/clean Windows',
      'native OS confirmation dialog rendering and human decisions',
      'CPU-capable/recommended-model performance', 'whole-process network/camera audit', 'native picker or Project mutation'] };
  put(output, 'result.json', result);
  const env = { ...process.env }; for (const key of Object.keys(env)) if (['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_ENABLE_LOGGING', 'ELECTRON_LOG_FILE'].includes(key.toUpperCase())) delete env[key];
  env.TEMP = env.TMP = owned(output, 'temp'); env.APPDATA = owned(output, 'appData'); env.LOCALAPPDATA = owned(output, 'localAppData'); env.PYTHONDONTWRITEBYTECODE = '1';
  let forced;
  const child = childProcess.spawn(electron, [self, '--', '--inspect-app', output, String(deadline)], { cwd: root, shell: false, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  result.electronPid = child.pid; result.outputBytes = 0;
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (bytes) => { result.outputBytes += bytes.length; });
  const timer = setTimeout(() => { result.failures.push('PARENT_DEADLINE'); if (child.connected) child.send('stop', () => {});
    forced = setTimeout(() => child.kill('SIGKILL'), 2000); }, 175000);
  const closed = await new Promise((done) => {
    child.once('error', () => result.failures.push('ELECTRON_SPAWN_FAILED'));
    child.once('close', (exitCode, signal) => done({ exitCode, signal }));
  });
  clearTimeout(timer); clearTimeout(forced); result.exit = closed;
  try {
    result.electron = get(output, 'electron.json'); result.hashesAfter = hashes();
    assert.deepEqual(result.hashesAfter, before, 'SOURCE_OR_BUNDLE_CHANGED');
    assert.ok(closed.exitCode === 0 && closed.signal === null && result.electron.gracefulWillQuit, 'ELECTRON_EXIT_UNCONFIRMED');
    assert.deepEqual(readdirSync(owned(output, 'userData/projects')), [], 'PROJECT_CREATED_WITHOUT_CONSENT');
    for (const item of result.electron.exports) {
      const bytes = readFileSync(owned(output, item.file));
      assert.ok(bytes.length === item.byteLength && sha(bytes) === item.sha256, 'SAVED_EXPORT_CHANGED');
    }
    result.status = result.failures.length ? 'FAIL' : result.electron.status === 'PASS' ? 'TECHNICAL_SMOKE_PASS' : result.electron.status;
  } catch (error) { result.failures.push(reason(error)); result.status = 'FAIL'; }
  result.elapsedMs = Date.now() - started; put(output, 'result.json', result);
  console.log(JSON.stringify({ status: result.status, result: owned(output, 'result.json'), elapsedMs: result.elapsedMs,
    cases: result.electron?.cases.map((c) => ({ name: c.name, status: c.status })), layoutFailures: result.electron?.screens.filter((s) => !s.metrics.pass).map((s) => s.name) }));
  process.exitCode = result.status === 'TECHNICAL_SMOKE_PASS' ? 0 : 1;
}
const args = process.argv.slice(2); if (args[0] === '--') args.shift();
if (process.type === 'browser') {
  assert.ok(args.length === 3 && args[0] === '--inspect-app', 'USE_NATIVE_LAUNCHER');
  // Evaluation must finish before Electron emits ready. Never top-level-await it.
  void inspect(resolve(args[1]), Number(args[2])).catch(() => require('electron').app.exit(1));
} else {
  assert.equal(args.length, 0, 'UNEXPECTED_ARGUMENTS');
  void launch().catch((error) => { console.error(reason(error)); process.exitCode = 1; });
}