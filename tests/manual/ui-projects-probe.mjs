import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, lstatSync, mkdirSync, readdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// One parent-registered UIR-025A technical-smoke leaf.
// Native Node 24.19.x: node tests/manual/ui-projects-probe.mjs. No build, fixture bundle or production patches.
const self = fileURLToPath(import.meta.url), root = realpathSync(resolve(dirname(self), '../..'));
const require = createRequire(import.meta.url), main = join(root, 'dist/main/index.js');
const renderer = join(root, 'dist/renderer/index.html'), binding = join(root, 'node_modules/better-sqlite3/prebuilds/win32-x64.node');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const A = '検証Project A', updatedA = '検証Project A 更新', B = '検証Project B';
const descriptionA = '保存する説明 🌾', updatedDescription = '更新した説明 🌾', descriptionB = '別Projectの説明';
const payload = Buffer.from('UIR-025A test-owned move payload\n'), sentinel = Buffer.from('UIR-025A external reference sentinel 🌾\n');
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const samePath = (a, b) => typeof a === 'string' && resolve(a).toLowerCase() === resolve(b).toLowerCase();
const reason = (error) => String(error?.message ?? '').match(/^([A-Z][A-Z0-9_:-]{0,95})(?:\r?\n|$)/)?.[1]
  ?? (/^[A-Z][A-Z0-9_]{0,63}$/.test(error?.code ?? '') ? error.code : 'UNEXPECTED_FAILURE');
function owned(output, part) {
  const path = resolve(output, part), local = relative(output, path);
  assert.ok(local && !isAbsolute(local) && local !== '..' && !local.startsWith('..\\'), 'OUTPUT_ESCAPE');
  let cursor = output;
  for (const segment of ['', ...local.split('\\')]) {
    cursor = join(cursor, segment);
    try { const stat = lstatSync(cursor); assert.ok(!stat.isSymbolicLink() && (stat.isDirectory() || (stat.isFile() && stat.nlink === 1)), 'OUTPUT_LINK_OR_SPECIAL_FILE'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  return path;
}
function put(output, name, value) {
  const path = owned(output, name), bytes = JSON.stringify(value, null, 2);
  assert.ok(Buffer.byteLength(bytes) <= 1024 * 1024, 'EVIDENCE_SIZE_LIMIT');
  writeFileSync(path, bytes, { flag: existsSync(path) ? 'w' : 'wx' });
}
const json = (output, name) => JSON.parse(readFileSync(owned(output, name), 'utf8'));
const fingerprint = (path) => { const bytes = readFileSync(path); return { bytes: bytes.length, sha256: sha(bytes) }; };
function hashes(node, electron) {
  const files = ['package.json', 'package-lock.json', 'vite.main.config.ts', 'vite.preload.config.ts', 'vite.renderer.config.ts',
    'src/main/index.ts', 'src/main/app-lifecycle.ts', 'src/main/window.ts', 'src/main/security.ts', 'src/main/paths.ts',
    'src/main/db/database.ts', 'src/main/db/backup.ts', 'src/main/db/migrate.ts', 'src/main/db/migrations/001_core.sql', 'src/main/db/migrations/002_jobs.sql',
    'src/main/projects/project-service.ts', 'src/main/projects/project-directory.ts', 'src/main/projects/project-move.ts',
    'src/main/projects/project-move-receipt.ts', 'src/main/projects/project-repository.ts', 'src/main/ipc/project-handlers.ts',
    'src/preload/index.ts', 'src/preload/project-api.ts', 'src/shared/contracts/app.ts', 'src/shared/contracts/project.ts', 'src/shared/contracts/project-ipc.ts',
    'src/renderer/main.tsx', 'src/renderer/App.tsx', 'src/renderer/routes.tsx', 'src/renderer/layout/AppShell.tsx', 'src/renderer/layout/AppShell.test.tsx',
    'src/renderer/layout/ProjectWorkspace.tsx', 'src/renderer/layout/WorkflowTabs.tsx', 'src/renderer/features/projects/ProjectListPage.tsx',
    'src/renderer/features/projects/ProjectListPage.css', 'src/renderer/features/projects/ProjectListPage.test.tsx',
    'src/renderer/features/projects/ProjectForm.tsx', 'src/renderer/features/projects/ProjectForm.css',
    'src/renderer/features/settings/ProjectSettingsPanel.tsx', 'src/renderer/features/settings/SettingsPage.tsx',
    'src/renderer/styles/global.css', 'src/renderer/styles/tokens.css', 'tests/manual/ui-projects-probe.mjs',
    'node_modules/better-sqlite3/package.json', 'node_modules/better-sqlite3/lib/index.js', 'node_modules/better-sqlite3/lib/binding.js',
    'node_modules/better-sqlite3/lib/database.js', 'node_modules/better-sqlite3/prebuilds/win32-x64.node'];
  for (const dir of ['dist/main', 'dist/preload', 'dist/renderer', 'dist/renderer/assets']) {
    const entries = readdirSync(join(root, dir)); assert.ok(entries.length > 0 && entries.length <= 64, 'BUNDLE_INVENTORY_LIMIT');
    for (const name of entries) {
      if (dir === 'dist/renderer' && name === 'assets') continue;
      const path = join(root, dir, name), stat = lstatSync(path);
      assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'UNEXPECTED_BUNDLE_ENTRY'); files.push(`${dir}/${name}`);
    }
  }
  return Object.fromEntries([...files.sort().map((file) => [file, fingerprint(join(root, file))]), ['@native-node', fingerprint(node)], ['@native-electron', fingerprint(electron)]]);
}
function sqliteFact() {
  const version = JSON.parse(readFileSync(join(root, 'node_modules/better-sqlite3/package.json'), 'utf8')).version;
  assert.equal(version, '13.0.3', 'SQLITE_VERSION_CHANGED');
  const loaded = Object.keys(require.cache).filter((file) => file.endsWith('.node') && file.includes('better-sqlite3')).map((file) => realpathSync(file));
  assert.deepEqual(loaded.map((p) => p.toLowerCase()), [realpathSync(binding).toLowerCase()], 'DEFAULT_NAPI_PREBUILD_NOT_LOADED');
  return { version, binding: realpathSync(binding), ...fingerprint(binding), napi: process.versions.napi, modules: process.versions.modules };
}
function projectRoot(output, id, path, parent) {
  assert.match(id, uuid, 'INVALID_PROJECT_UUID');
  assert.ok(samePath(path, owned(output, `projectparents/${parent}/${id}`)), 'PROJECT_ROOT_ESCAPED');
  assert.ok(samePath(realpathSync(path), path) && basename(path) === id, 'PROJECT_ROOT_ID_MISMATCH');
  const marker = owned(output, relative(output, join(path, '.autovision-project.json')));
  assert.equal(readFileSync(marker, 'utf8'), `${JSON.stringify({ schemaVersion: 1, projectId: id })}\n`, 'PROJECT_MARKER_MISMATCH');
  return { id, root: path, marker: fingerprint(marker) }; // Names live in SQLite, NOT in the ownership marker.
}
function inspectDatabase(output, projects) {
  const path = owned(output, 'userData/metadata.sqlite3'), related = [path, `${path}-wal`, `${path}-shm`];
  const state = () => related.map((p) => { owned(output, relative(output, p)); return existsSync(p) ? fingerprint(p) : null; });
  const before = state(), uriSetting = process.env.SQLITE_USE_URI; let db, rows, version;
  assert.ok(before[0] && before[1] === null && before[2] === null, 'SHUTDOWN_NOT_CHECKPOINTED');
  process.env.SQLITE_USE_URI = '1'; // 13.0.3 Addon::ConfigureURI; parent only, BEFORE its first native load. Child env is already snapshotted.
  try {
    db = new (require('better-sqlite3'))(`${pathToFileURL(path).href}?mode=ro&immutable=1`, { readonly: true, fileMustExist: true, timeout: 1000 });
    assert.ok(db.readonly && samePath(db.pragma('database_list')[0].file, path), 'READONLY_DATABASE_PATH_MISMATCH');
    version = db.pragma('user_version', { simple: true }); assert.equal(version, 2, 'MIGRATION_VERSION_MISMATCH');
    assert.equal(db.prepare('SELECT count(*) AS count FROM projects').get().count, 2, 'PERSISTED_PROJECT_COUNT_MISMATCH');
    rows = db.prepare('SELECT id,name,description,task_type,task_type_locked,workspace_path FROM projects ORDER BY id').all();
    const expected = [[projects.a, updatedA, updatedDescription], [projects.b, B, descriptionB]].map(([p, name, description]) => ({
      id: p.id, name, description, task_type: 'classification', task_type_locked: 0, workspace_path: p.root,
    })).sort((a, b) => a.id.localeCompare(b.id));
    assert.deepEqual(rows, expected, 'PERSISTED_PROJECTS_MISMATCH');
    assert.deepEqual(state(), before, 'READONLY_OPEN_CHANGED_DB_OR_WAL');
  } finally {
    try { db?.close(); assert.ok(!db?.open, 'READONLY_DB_CLOSE_FAILED'); assert.deepEqual(state(), before, 'READONLY_CLOSE_CHANGED_DB_OR_WAL'); }
    finally { if (uriSetting === undefined) delete process.env.SQLITE_USE_URI; else process.env.SQLITE_USE_URI = uriSetting; }
  }
  const a = projectRoot(output, projects.a.id, projects.a.root, 'move'), b = projectRoot(output, projects.b.id, projects.b.root, 'create');
  assert.notEqual(a.id, b.id, 'PROJECT_IDS_NOT_DISTINCT');
  assert.equal(existsSync(owned(output, `projectparents/create/${a.id}`)), false, 'OLD_ROOT_RETAINED');
  assert.deepEqual(readFileSync(owned(output, `projectparents/move/${a.id}/probe-payload.txt`)), payload, 'MOVED_PAYLOAD_CHANGED');
  assert.deepEqual(readFileSync(owned(output, 'projectparents/create/reference-sentinel.txt')), sentinel, 'REFERENCE_SENTINEL_CHANGED');
  return { status: 'PASS', readonly: true, fileMustExist: true, immutable: true, unchanged: true, before, after: state(), version, rows, roots: [a, b], native: sqliteFact() };
}
// DOM observations only: never call/replace window.autoVision, IPC, services or React state.
function view() {
  const q = (s) => document.querySelector(s), list = q('.project-list-page');
  const form = [...document.querySelectorAll('form.project-form')].find((e) => e.getClientRects().length && !e.closest('[hidden]'));
  return { context: q('.app-shell__header > .app-shell__context')?.textContent,
    listReady: list?.querySelector('[role=status]')?.textContent === '取得済み', count: list?.querySelector('.project-list-page__pager span')?.textContent,
    rows: [...(list?.querySelectorAll('[data-project-id]') ?? [])].map((e) => ({ id: e.dataset.projectId, name: e.querySelector('.project-list-page__name')?.textContent })),
    workspaceId: q('.app-shell__workflow')?.dataset.projectId, workspaceName: q('#project-workspace-heading')?.textContent,
    tab: q('.workflow-tabs [aria-selected=true]')?.id,
    form: form ? { heading: form.querySelector('h1')?.textContent, name: form.querySelector('input[type=text]')?.value,
      description: form.querySelector('textarea')?.value, status: form.querySelector('[role=status]')?.textContent,
      busy: !!form.querySelector('[aria-busy="true"]'),
      path: form.querySelector('.project-form__destination .project-form__path')?.textContent } : null };
}
async function drive(window, output, phase, report, armPicker, step) {
  const wc = window.webContents, js = (fn, ...args) => wc.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);
  const settle = () => js(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
  const ready = async (predicate, ...args) => {
    const result = await wc.executeJavaScript(`(async () => { const read = ${view.toString()}, started=performance.now();
      for (let n=0;n<120;n++) { const state=read(); if ((${predicate.toString()})(state,...${JSON.stringify(args)}))
        return {matched:true,state,frames:n+1,elapsedMs:performance.now()-started};
        await new Promise(done=>requestAnimationFrame(done)); }
      return {matched:false,state:read(),frames:120,elapsedMs:performance.now()-started}; })()`);
    report.lastView = result.state;
    report.lastWait = { matched: result.matched, frames: result.frames, elapsedMs: result.elapsedMs };
    assert.ok(result.matched, 'UI_READY_TIMEOUT');
    await settle(); return result.state;
  };
  const click = async (selector) => {
    window.show(); window.focus(); wc.focus();
    const before = await js((s) => { const e = document.querySelector(s); if (!e || e.closest('[hidden]')) throw new Error('CLICK_TARGET_MISSING');
      const position = [scrollX, scrollY]; e.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }); return position; }, selector);
    await settle();
    const point = await js((s) => { const e = document.querySelector(s), r = e.getBoundingClientRect(), x = Math.floor(r.x + r.width / 2), y = Math.floor(r.y + r.height / 2);
      const target = document.elementFromPoint(x, y); return { x, y, rect: r.toJSON(), scroll: [scrollX, scrollY],
        reachable: document.hasFocus() && !e.matches(':disabled') && getComputedStyle(e).visibility === 'visible' && r.width > 0 && r.height > 0
          && r.x >= 0 && r.y >= 0 && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && (target === e || e.contains(target)) }; }, selector);
    report.actions.push({ selector, before, ...point }); assert.ok(point.reachable, 'NATIVE_CLICK_UNREACHABLE');
    for (const type of ['mouseMove', 'mouseDown', 'mouseUp']) wc.sendInputEvent({ type, x: point.x, y: point.y, button: 'left', clickCount: 1 });
    await settle();
  };
  const edit = async (selector, value) => {
    await click(selector); assert.ok(await js((s) => document.activeElement === document.querySelector(s), selector), 'NATIVE_EDIT_NOT_FOCUSED');
    for (const [keyCode, modifiers] of [['A', ['control']], ['Backspace', []]]) {
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers }); wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    }
    await wc.insertText(value); await settle();
    assert.equal(await js((s) => document.querySelector(s).value, selector), value, 'NATIVE_EDIT_VALUE_MISMATCH');
  };
  const capture = async (name) => {
    const record = { name, stable: false, metrics: await js(() => ({ viewport: [innerWidth, innerHeight], devicePixelRatio,
      scroll: [scrollX, scrollY], document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight],
      dark: matchMedia('(prefers-color-scheme: dark)').matches,
      controls: [...document.querySelectorAll('main button, main input, main textarea, main a')].filter((e) => e.getClientRects().length && !e.closest('[hidden]'))
        .map((e) => ({ tag: e.tagName, disabled: e.matches(':disabled'), rect: e.getBoundingClientRect().toJSON(),
          overflow: [e.scrollWidth > e.clientWidth + 1, e.scrollHeight > e.clientHeight + 1] })) })) };
    report.screenshots.push(record); assert.deepEqual(record.metrics.viewport, [1280, 640], 'VIEWPORT_MISMATCH');
    assert.equal(record.metrics.dark, false, 'LIGHT_THEME_MISMATCH');
    let png, previous;
    for (record.attempts = 1; record.attempts <= 8; record.attempts++) {
      wc.invalidate(); await settle(); const image = await wc.capturePage(); assert.equal(image.isEmpty(), false, 'EMPTY_CAPTURE');
      png = image.toPNG(); record.imageSize = image.getSize(); const hash = sha(png);
      if (hash === previous && hash !== report.screenshots.at(-2)?.sha256) { record.stable = true; break; } previous = hash;
    }
    record.attempts = Math.min(record.attempts, 8); record.file = `${phase}-${name}.png`; record.sha256 = sha(png);
    writeFileSync(owned(output, record.file), png, { flag: 'wx' }); assert.equal(fingerprint(owned(output, record.file)).sha256, record.sha256, 'CAPTURE_WRITE_MISMATCH');
    assert.ok(record.stable, 'CAPTURE_NOT_STABLE_OR_NOT_CHANGED');
  };
  const form = 'form.project-form', nameInput = `${form} .project-form__name input`, descriptionOpen = `${form} .project-form__metadata > button`;
  const descriptionBack = `${form} .project-form__description > button`, submit = `${form} > .project-form__actions > button[type=submit]`;
  const back = `${form} > .project-form__actions > button:last-child`, location = `${form} fieldset[aria-label="保存場所の変更・復旧"]`;
  const list = async (count) => ready((s, n) => s.listReady && s.count?.includes(`（全${n}件）`), count);
  const nextPage = '.project-list-page__pager [aria-label="Project: 次のページ"]';
  const open = async (id) => { assert.match(id, uuid, 'INVALID_ROW_ID');
    if (!(await js(view)).rows.some((row) => row.id === id)) await click(await js((s) => document.querySelector(s).disabled, nextPage)
      ? '.project-list-page__pager [aria-label="Project: 最初のページ"]' : nextPage); // Two rows/pages: at most ONE page change.
    await ready((s, value) => s.listReady && s.rows.some((row) => row.id === value), id);
    await click(`.project-list-page__list > [data-project-id="${id}"] .project-list-page__actions > button:first-child`);
    return ready((s, value) => s.workspaceId === value, id); };
  const settings = async (name) => { await click('#project-workspace-project-settings'); return ready((s, n) => s.form?.heading === 'Project 設定' && s.form.name === n, name); };
  const create = async (name, description, screenshot) => {
    await click('.project-list-page__toolbar > button:first-of-type'); await ready((s) => s.form?.heading === 'Project を作成');
    await edit(nameInput, name); await click(descriptionOpen); await edit(`${form} textarea`, description); await click(descriptionBack);
    armPicker('create'); await click(`${form} .project-form__parent button`); await ready((s) => s.form?.status === '親フォルダーを選択しました。');
    if (screenshot) await capture('create'); await click(submit);
    const state = await ready((s, n) => s.workspaceName === n && !!s.workspaceId, name), id = state.workspaceId;
    assert.match(id, uuid, 'INVALID_CREATED_ID'); return projectRoot(output, id, owned(output, `projectparents/create/${id}`), 'create');
  };
  window.setContentSize(1280, 640); wc.setZoomFactor(1); window.show(); window.focus(); wc.focus(); await settle();
  if (phase === 'create-edit-move') {
    await step('empty-list', async () => { const state = await list(0); assert.deepEqual(state.rows, [], 'PROFILE_NOT_EMPTY');
      assert.equal(state.context, 'Project 未選択', 'UNEXPECTED_INITIAL_SELECTION'); await capture('list'); });
    await step('create-A', async () => { report.projects.a = await create(A, descriptionA, true);
      writeFileSync(owned(output, `projectparents/create/${report.projects.a.id}/probe-payload.txt`), payload, { flag: 'wx' }); });
    await step('save-A', async () => { await click('#workflow-tab-annotations'); await ready((s) => s.tab === 'workflow-tab-annotations');
      const state = await settings(A); assert.equal(state.form.path, report.projects.a.root, 'CREATED_UI_ROOT_MISMATCH');
      await click(descriptionOpen); assert.equal((await js(view)).form.description, descriptionA, 'CREATED_DESCRIPTION_MISMATCH'); await click(descriptionBack);
      await edit(nameInput, updatedA); await click(descriptionOpen); await edit(`${form} textarea`, updatedDescription); await click(descriptionBack); await click(submit);
      await ready((s, n) => s.form?.status?.includes('Project情報を保存しました。') && s.context === `Project：${n}`, updatedA);
    });
    await step('move-A', async () => { armPicker('move'); await click(`${location} button:first-child`); await ready((s) => s.form?.status?.includes('まだ移動していません。'));
      await click(`${location} button:nth-child(2)`); const target = owned(output, `projectparents/move/${report.projects.a.id}`);
      await ready((s, p) => s.form?.path === p && s.form.status.includes('旧領域の回収は完了しています。'), target);
      assert.equal(existsSync(report.projects.a.root), false, 'OLD_ROOT_RETAINED');
      report.projects.a = projectRoot(output, report.projects.a.id, target, 'move');
      assert.deepEqual(readFileSync(owned(output, `projectparents/move/${report.projects.a.id}/probe-payload.txt`)), payload, 'MOVED_PAYLOAD_CHANGED');
      assert.deepEqual(readFileSync(owned(output, 'projectparents/create/reference-sentinel.txt')), sentinel, 'REFERENCE_SENTINEL_CHANGED'); await capture('settings');
      await click(back); await ready((s, id, n) => s.workspaceId === id && s.workspaceName === n && s.tab === 'workflow-tab-annotations', report.projects.a.id, updatedA);
    });
    await step('create-B-preserve-A', async () => { await click('#app-shell-projects-link'); await list(1); assert.equal((await js(view)).rows[0]?.name, updatedA, 'LIST_RENAME_NOT_LIVE');
      report.projects.b = await create(B, descriptionB, false); assert.notEqual(report.projects.a.id, report.projects.b.id, 'PROJECT_IDS_NOT_DISTINCT');
      await click('#app-shell-projects-link'); await list(2); const state = await open(report.projects.a.id);
      assert.equal(state.workspaceName, updatedA, 'A_CHANGED_WHILE_CREATING_B'); assert.equal(state.tab, 'workflow-tab-annotations', 'A_TAB_NOT_PRESERVED');
      await capture('workspace');
    });
  } else {
    report.projects = json(output, 'create-edit-move.json').projects;
    await step('restart-list', async () => { const state = await list(2), rows = [...state.rows]; assert.equal(state.workspaceId, undefined, 'RESTART_AUTO_SELECTED_PROJECT');
      assert.equal(state.context, 'Project 未選択', 'RESTART_CONTEXT_MISMATCH');
      if (rows.length === 1) { await click(nextPage); rows.push(...(await ready((s, id) => s.listReady && s.rows[0]?.id !== id, rows[0].id)).rows); }
      assert.deepEqual(rows.toSorted((a, b) => a.id.localeCompare(b.id)), [{ id: report.projects.a.id, name: updatedA }, { id: report.projects.b.id, name: B }]
        .sort((a, b) => a.id.localeCompare(b.id)), 'RESTART_LIST_MISMATCH'); await capture('restart'); });
    await step('restart-open-A', async () => { const workspace = await open(report.projects.a.id); assert.equal(workspace.workspaceName, updatedA, 'RESTART_NAME_MISMATCH');
      assert.equal(workspace.tab, 'workflow-tab-import', 'RESTART_TAB_NOT_DEFAULT'); // Only in-process tab retention is promised.
      const state = await settings(updatedA); assert.equal(state.form.path, report.projects.a.root, 'RESTART_ROOT_MISMATCH');
      await click(descriptionOpen); assert.equal((await js(view)).form.description, updatedDescription, 'RESTART_DESCRIPTION_MISMATCH');
      await click(descriptionBack); await click(back); await ready((s, id) => s.workspaceId === id && s.tab === 'workflow-tab-import', report.projects.a.id);
    });
  }
}
async function runElectron(phase, output, deadline) {
  const { app, dialog, nativeTheme, session } = require('electron');
  assert.ok(!app.isReady() && process.connected && process.platform === 'win32' && process.arch === 'x64', 'ELECTRON_LAUNCHER_REQUIRED');
  assert.ok(samePath(dirname(output), join(root, 'test-results')) && basename(output).startsWith('ui-projects-') && uuid.test(basename(output).slice(12)), 'INVALID_OUTPUT');
  const owner = json(output, 'owner.json'); assert.equal(owner.runId, basename(output), 'OWNER_MISMATCH');
  assert.ok(Number.isFinite(deadline) && deadline > Date.now() && deadline <= owner.deadline, 'INVALID_DEADLINE');
  app.setName(basename(output)); // Unique single-instance lock; do not change the global AppUserModelID.
  for (const name of ['userData', 'sessionData', 'crashDumps']) app.setPath(name, owned(output, name));
  app.setAppLogsPath(owned(output, `logs/${phase}`));
  for (const name of ['disable-background-networking', 'disable-component-update']) app.commandLine.appendSwitch(name);
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
  const planned = phase === 'preflight' ? ['native-memory-SQL'] : phase === 'restart' ? ['restart-list', 'restart-open-A']
    : ['empty-list', 'create-A', 'save-A', 'move-A', 'create-B-preserve-A'];
  const report = { phase, status: 'RUNNING', runtime: { ...process.versions }, executable: realpathSync(process.execPath),
    cases: planned.map((name) => ({ name, status: 'NOTRUN' })), projects: {}, actions: [], screenshots: [], pickers: [], failures: [],
    guards: { nonFileRequests: 0, unexpectedFiles: 0, permissionChecks: 0, permissionRequests: 0, rendererErrors: 0, mediaPlayback: 0 },
    permissionKinds: [], gracefulWillQuit: false };
  assert.equal(existsSync(owned(output, `${phase}.json`)), false, 'PHASE_ALREADY_EXISTS'); put(output, `${phase}.json`, report);
  let closing = false, forced, queued, windows = 0;
  const persist = () => put(output, `${phase}.json`, report);
  // Chromium also queries permission state without requesting access. Every
  // check remains denied; requests, playback and other unexpected activity fail.
  const unexpectedActivity = () => Object.entries(report.guards).some(([key, count]) => key !== 'permissionChecks' && count !== 0);
  const finish = (error) => {
    if (error && report.failures.length < 16) report.failures.push(reason(error));
    if (closing) { report.status = 'FAIL'; persist(); return; } closing = true; clearTimeout(watchdog);
    for (const item of report.cases) if (item.status === 'RUNNING') { item.status = 'FAIL'; item.failure = error ? reason(error) : 'INCOMPLETE_CASE'; }
    report.status = !report.failures.length && report.cases.every((c) => c.status === 'PASS') ? 'PASS' : 'FAIL';
    forced = setTimeout(() => { report.status = 'FAIL'; report.failures.push('FORCED_SELF_EXIT'); try { persist(); } finally { app.exit(1); } }, 1500);
    try { persist(); } finally { app.quit(); }
  };
  const watchdog = setTimeout(() => finish(new Error('CHILD_DEADLINE')), Math.max(1, deadline - Date.now() - 1500));
  process.on('message', (m) => { if (m === 'stop') finish(new Error('PARENT_STOP')); });
  process.on('uncaughtException', finish); process.on('unhandledRejection', finish);
  app.once('will-quit', () => { report.gracefulWillQuit = true; if (!closing) { report.status = 'FAIL'; report.failures.push('UNEXPECTED_QUIT'); }
    if (unexpectedActivity()) { report.status = 'FAIL'; report.failures.push('UNEXPECTED_GUARD_ACTIVITY'); }
    persist(); clearTimeout(forced); clearTimeout(watchdog); });
  dialog.showErrorBox = (_title, text) => finish(new Error(String(text).match(/MAIN_[A-Z_]+/)?.[0] ?? 'MAIN_ERROR_BOX'));
  dialog.showOpenDialog = async (...args) => {
    const selected = queued; queued = undefined;
    try {
      assert.ok(selected && phase === 'create-edit-move', 'UNEXPECTED_PICKER'); assert.equal(args.length, 1, 'PICKER_ARGUMENTS_CHANGED');
      assert.deepEqual(args[0], { properties: ['openDirectory'], title: selected.purpose === 'create' ? 'Projectの親フォルダーを選択' : 'Project移動先の親フォルダーを選択' }, 'PICKER_OPTIONS_CHANGED');
      const path = owned(output, `projectparents/${selected.purpose === 'create' ? 'create' : 'move'}`);
      assert.ok(lstatSync(path).isDirectory(), 'PICKER_PARENT_MISSING'); report.pickers.push({ purpose: selected.purpose, parent: path });
      return { canceled: false, filePaths: [path] }; // Only the dialog response; Main generates and consumes the real capability.
    } catch (error) { finish(error); return { canceled: true, filePaths: [] }; }
  };
  const step = async (name, action) => { assert.ok(!closing, 'PHASE_STOPPED'); const item = report.cases.find((c) => c.name === name); item.status = 'RUNNING'; persist();
    try { await action(); assert.ok(!closing, 'PHASE_STOPPED'); item.status = 'PASS'; } catch (error) { item.status = 'FAIL'; item.failure = reason(error); throw error; } finally { persist(); } };
  try {
    await app.whenReady(); nativeTheme.themeSource = 'light';
    session.defaultSession.setPermissionCheckHandler((_wc, permission) => {
      report.guards.permissionChecks++;
      if (report.permissionKinds.length < 32) report.permissionKinds.push({ kind: 'check', permission, allowed: false });
      return false;
    });
    session.defaultSession.setPermissionRequestHandler((_wc, permission, callback) => {
      report.guards.permissionRequests++;
      if (report.permissionKinds.length < 32) report.permissionKinds.push({ kind: 'request', permission, allowed: false });
      callback(false);
    });
    const loaded = new Set();
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => {
      let allowed = false;
      try { const file = fileURLToPath(details.url), local = relative(join(root, 'dist/renderer'), file);
        allowed = !!local && !isAbsolute(local) && local !== '..' && !local.startsWith('..\\') && existsSync(file);
        if (allowed) loaded.add(relative(root, file).replaceAll('\\', '/')); else report.guards.unexpectedFiles++;
      } catch { report.guards.nonFileRequests++; } callback({ cancel: !allowed });
    });
    if (phase === 'preflight') {
      await step('native-memory-SQL', async () => { const db = new (require('better-sqlite3'))(':memory:');
        try { db.exec('CREATE TABLE probe(value TEXT NOT NULL)'); db.prepare('INSERT INTO probe(value) VALUES (?)').run(descriptionA);
          assert.deepEqual(db.prepare('SELECT value FROM probe').all(), [{ value: descriptionA }], 'MEMORY_SQL_MISMATCH'); }
        finally { db.close(); assert.equal(db.open, false, 'MEMORY_SQL_CLOSE_FAILED'); }
        report.native = sqliteFact(); report.actualMemorySQLite = true;
      });
    } else {
      if (phase === 'create-edit-move') assert.equal(existsSync(owned(output, 'userData/metadata.sqlite3')), false, 'PROFILE_DB_ALREADY_EXISTS');
      const windowReady = new Promise((done) => app.on('browser-window-created', (_event, window) => {
        if (++windows !== 1) { finish(new Error('UNEXPECTED_WINDOW')); return; }
        const wc = window.webContents;
        wc.on('preload-error', () => finish(new Error('PRELOAD_ERROR'))); wc.on('did-fail-load', () => finish(new Error('RENDERER_LOAD_FAILED')));
        wc.on('render-process-gone', () => { if (!closing) finish(new Error('RENDERER_EXITED')); });
        wc.on('console-message', (details) => { if (details.level === 'error') report.guards.rendererErrors++; });
        wc.on('media-started-playing', () => { report.guards.mediaPlayback++; });
        wc.once('did-finish-load', () => done(window)); window.once('closed', () => { if (!closing) finish(new Error('WINDOW_CLOSED_EARLY')); });
      }));
      await import(pathToFileURL(main).href); // Actual dist entry: preserve its preload, resources, ml cwd, migrations and recovery.
      const window = await windowReady, wc = window.webContents;
      assert.equal(wc.getURL(), pathToFileURL(renderer).href, 'NOT_ACTUAL_RENDERER');
      const capabilities = await wc.executeJavaScript(`({version:window.autoVision?.contractVersion,node:typeof require,
        projects:['list','get','create','update','pickParent','move','recover'].every(k=>typeof window.autoVision?.projects?.[k]==='function')})`);
      assert.deepEqual(capabilities, { version: 1, node: 'undefined', projects: true }, 'PRODUCTION_BRIDGE_UNAVAILABLE');
      report.entry = { main, preloadPathResolvedByUnmodifiedMain: join(root, 'dist/preload/index.cjs'), renderer: wc.getURL(), isPackaged: app.isPackaged, capabilities };
      await drive(window, output, phase, report, (purpose) => { assert.equal(queued, undefined, 'PICKER_ALREADY_ARMED'); queued = { purpose }; }, step);
      report.native = sqliteFact(); report.loadedRendererFiles = [...loaded].sort();
      assert.ok(loaded.has('dist/renderer/index.html') && [...loaded].some((p) => p.endsWith('.js')) && [...loaded].some((p) => p.endsWith('.css')), 'BUNDLE_LOAD_INCOMPLETE');
      assert.equal(wc.getURL(), pathToFileURL(renderer).href, 'RENDERER_ENTRY_CHANGED');
    }
    assert.equal(queued, undefined, 'UNUSED_PICKER_SELECTION');
    assert.deepEqual(report.pickers.map((p) => p.purpose), phase === 'create-edit-move' ? ['create', 'move', 'create'] : [], 'PICKER_SEQUENCE_MISMATCH');
    assert.ok(!unexpectedActivity(), 'UNEXPECTED_NETWORK_PERMISSION_OR_RENDERER_ERROR'); finish();
  } catch (error) { finish(error); }
}
async function launch() {
  const started = Date.now(), deadline = started + 180_000;
  assert.ok(!process.versions.electron && process.release.name === 'node' && process.platform === 'win32' && process.arch === 'x64'
    && /^24\.19\.\d+$/.test(process.versions.node) && basename(process.execPath).toLowerCase() === 'node.exe', 'NATIVE_NODE_24_19_REQUIRED');
  const node = realpathSync(process.execPath), electron = realpathSync(require('electron'));
  assert.equal(basename(electron).toLowerCase(), 'electron.exe', 'NATIVE_ELECTRON_REQUIRED');
  const results = join(root, 'test-results'); mkdirSync(results, { recursive: true }); assert.equal(lstatSync(results).isSymbolicLink(), false, 'RESULTS_IS_LINK');
  const output = join(results, `ui-projects-${randomUUID()}`); mkdirSync(output);
  for (const dir of ['userData', 'sessionData', 'crashDumps', 'logs/preflight', 'logs/create-edit-move', 'logs/restart', 'temp', 'appData', 'localAppData', 'projectparents/create', 'projectparents/move']) mkdirSync(owned(output, dir), { recursive: true });
  writeFileSync(owned(output, 'projectparents/create/reference-sentinel.txt'), sentinel, { flag: 'wx' });
  put(output, 'owner.json', { runId: basename(output), deadline, node, electron });
  const result = { status: 'RUNNING', startedAt: new Date(started).toISOString(), scope: 'UIR-025A actual-dist technical smoke, NOT product/user acceptance',
    runtime: { node: process.versions, nodeExecutable: node, electronExecutable: electron }, phases: [], databases: {}, failures: [], actualSQLite: false,
    limits: { wholeMs: 180000, preflightMs: 60000, createEditMoveMs: 90000, restartMs: 60000, readyFrames: 120, captureAttempts: 8, screenshots: 5 },
    notTested: ['userConfirmation: NOTRUN', 'nativePicker: NOTRUN', 'UI-008 density/no-scroll: NOTRUN', 'UIN-04 acceptance: NOTRUN',
      'CORE-13A / PRE-03: NOTRUN', 'packaging/signing/clean install: NOTRUN', 'Narrator/IME: NOTRUN', 'models/camera/training: NOTRUN', 'full Reference graph: NOTRUN'],
    overrides: ['dialog.showOpenDialog queued fixture parents', 'dialog.showErrorBox capture-and-quit', 'isolated-session deny network/permissions',
      'parent-only SQLITE_USE_URI=1 for immutable reads; Electron environment unchanged', '1280x640, zoom 1, light, native show/focus'],
    qualifications: ['scroll is recorded and allowed for smoke, not a density PASS', 'session request guard is not packet capture or production-security verification',
      'permission checks are denied state queries, not proof of media capture; requests/playback must remain zero',
      'no rebuild: source/bundle hashes do not prove compilation freshness', 'reference sentinel is an outside-root fixture, not a registered Reference entity'] };
  let child, finalized = false;
  const finalize = (error) => {
    if (finalized) return result; finalized = true;
    if (error) result.failures.push(reason(error));
    try { result.hashesAfter = hashes(node, electron); assert.deepEqual(result.hashesAfter, result.hashesBefore, 'SOURCE_BUNDLE_OR_BINARY_CHANGED');
      assert.deepEqual(readFileSync(owned(output, 'projectparents/create/reference-sentinel.txt')), sentinel, 'REFERENCE_SENTINEL_CHANGED'); }
    catch (failure) { result.failures.push(reason(failure)); }
    result.elapsedMs = Date.now() - started;
    result.status = !result.failures.length && result.actualSQLite && result.phases.length === 3 && result.phases.every((p) => p.status === 'PASS')
      && Object.keys(result.databases).length === 2 ? 'TECHNICAL_SMOKE_PASS' : 'FAIL';
    put(output, 'result.json', result); console.log(JSON.stringify({ status: result.status, result: join(output, 'result.json') })); return result;
  };
  const watchdog = setTimeout(() => { child?.kill('SIGKILL'); try { finalize(new Error('WHOLE_180S_DEADLINE')); } finally { process.exit(1); } }, Math.max(1, deadline - Date.now()));
  const env = { ...process.env }; for (const key of ['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_ENABLE_LOGGING', 'ELECTRON_LOG_FILE']) delete env[key];
  env.TEMP = env.TMP = owned(output, 'temp'); env.APPDATA = owned(output, 'appData'); env.LOCALAPPDATA = owned(output, 'localAppData');
  const phase = (name, limit) => new Promise((done, reject) => {
    const end = Math.min(deadline - 2000, Date.now() + limit); assert.ok(end > Date.now() + 2000, 'INSUFFICIENT_PHASE_BUDGET');
    const args = [self, '--', name === 'preflight' ? '--preflight' : `--phase=${name}`, output, String(end)];
    const record = { name, executable: electron, args, status: 'RUNNING', timedOut: false, outputBytes: 0 }; result.phases.push(record); put(output, 'result.json', result);
    const logHash = createHash('sha256'); let killTimer;
    const ownedChild = child = spawn(electron, args, { cwd: root, shell: false, windowsHide: false, env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    for (const stream of [ownedChild.stdout, ownedChild.stderr]) stream.on('data', (bytes) => { record.outputBytes += bytes.length; logHash.update(bytes); }); // Drain, never retain raw model/device/secret logs.
    const timer = setTimeout(() => { record.timedOut = true; if (ownedChild.connected) ownedChild.send('stop', () => {});
      killTimer = setTimeout(() => ownedChild.kill('SIGKILL'), 1500); }, Math.max(1, end - Date.now() - 1500));
    ownedChild.once('error', (error) => { record.spawnError = reason(error); });
    ownedChild.once('close', (code, signal) => {
      clearTimeout(timer); clearTimeout(killTimer); child = undefined; record.exitCode = code; record.signal = signal; record.combinedOutputSha256 = logHash.digest('hex');
      try { const evidence = json(output, `${name}.json`); record.evidence = `${name}.json`;
        assert.ok(code === 0 && !record.timedOut && !record.spawnError && evidence.status === 'PASS' && evidence.gracefulWillQuit, 'PHASE_FAILED');
        record.status = 'PASS'; done(evidence);
      } catch (error) { record.status = 'FAIL'; record.failure = reason(error); reject(error); }
    });
  });
  let failure;
  try {
    result.hashesBefore = hashes(node, electron); put(output, 'result.json', result);
    assert.deepEqual(readdirSync(owned(output, 'userData')), [], 'PROFILE_NOT_NEW');
    const preflight = await phase('preflight', 60000); assert.equal(preflight.actualMemorySQLite, true, 'MEMORY_PREFLIGHT_INCOMPLETE');
    const first = await phase('create-edit-move', 90000); result.databases.afterFirstExit = inspectDatabase(output, first.projects);
    const second = await phase('restart', 60000); result.databases.afterRestartExit = inspectDatabase(output, second.projects);
    assert.deepEqual(second.projects, first.projects, 'RESTART_PROJECT_IDENTITIES_CHANGED');
    assert.equal(first.screenshots.length + second.screenshots.length, 5, 'SCREENSHOT_COVERAGE_INCOMPLETE');
    result.actualSQLite = true;
  } catch (error) { failure = error; }
  finally { clearTimeout(watchdog); process.exitCode = finalize(failure).status === 'TECHNICAL_SMOKE_PASS' ? 0 : 1; }
}
const args = process.argv.slice(2); if (args[0] === '--') args.shift();
try {
  if (process.type === 'browser') {
    assert.equal(args.length, 3, 'INVALID_CHILD_ARGUMENTS');
    const phase = args[0] === '--preflight' ? 'preflight' : args[0].replace(/^--phase=/, '');
    assert.ok(['preflight', 'create-edit-move', 'restart'].includes(phase), 'INVALID_PHASE');
    // NEVER top-level await app.whenReady(): Electron must finish evaluating this ESM entry first.
    void runElectron(phase, resolve(args[1]), Number(args[2])).catch((error) => { console.error(reason(error)); require('electron').app.exit(1); });
  } else { assert.equal(args.length, 0, 'USE_NATIVE_NODE_LAUNCHER'); void launch().catch((error) => { console.error(reason(error)); process.exitCode = 1; }); }
} catch (error) { console.error(reason(error)); if (process.type === 'browser') require('electron').app.exit(1); else process.exitCode = 1; }