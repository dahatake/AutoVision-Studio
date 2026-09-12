import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// UIR066: one parent-registered manual harness; never import a production entry.
// Intended launcher: native Node 24.19.x tests/manual/ui-diagnostics-probe.mjs.
const self = fileURLToPath(import.meta.url), root = resolve(dirname(self), '../..');
const label = 'component fixture – not real device observations';
const component = 'src/renderer/features/diagnostics/DiagnosticsPage';
const sourceFiles = [`${component}.tsx`, `${component}.css`, `${component}.test.tsx`,
  'src/renderer/styles/global.css', 'src/renderer/styles/tokens.css', 'tests/manual/ui-diagnostics-probe.mjs'];
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashes = () => Object.fromEntries(sourceFiles.map((file) => {
  try { return [file, sha256(readFileSync(join(root, file)))]; } catch { return [file, null]; }
}));
const save = (output, result) => writeFileSync(join(output, 'result.json'), JSON.stringify(result, null, 2));
function checkedOutput(value) {
  const output = resolve(value ?? '');
  assert.equal(dirname(output), join(root, 'test-results'));
  assert.match(basename(output), /^ui-diagnostics-[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/);
  return output;
}
function nativeNode() {
  assert.ok(!process.versions.electron && process.release.name === 'node' && process.platform === 'win32'
    && /^24\.19\.\d+$/.test(process.versions.node) && basename(process.execPath).toLowerCase() === 'node.exe',
  'Use native Windows Node 24.19.x, not Electron or ELECTRON_RUN_AS_NODE');
  return realpathSync(process.execPath);
}
function fixture(id) {
  const ok = (data) => ({ status: 'ok', data, error: null }), gib = 1024 ** 3;
  const report = { schemaVersion: 1, command: 'probe-hardware', status: 'ok',
    os: ok({ name: 'Windows', major: 10, minor: 0, build: 26100, productType: 1, architecture: 'AMD64' }),
    cpu: ok({ name: 'Intel(R) Core(TM) i7-13700H', logicalCount: 20 }),
    memory: ok({ totalBytes: 32 * gib, availableBytes: 20 * gib, loadPercent: 38 }),
    disk: ok({ totalBytes: 1024 * gib, usedBytes: 600 * gib, freeBytes: 424 * gib }),
    gpu: ok({ adapters: ['Intel Iris Xe Graphics', 'NVIDIA RTX 2000 Ada Generation Laptop GPU',
      'Microsoft Basic Display Adapter', 'Virtual Display Adapter'].map((name, i) => ({
      DeviceName: `DISPLAY${i + 1}`, DeviceString: name, StateFlags: 0,
    })), scope: 'current-session-display-adapters', computeStatus: 'not_checked' }),
    onnxRuntime: ok({ version: '1.22.1', providers: ['CPUExecutionProvider', 'DmlExecutionProvider'], executionStatus: 'not_checked' }),
    cuda: ok({ torchVersion: '2.8.0+cpu', runtimeVersion: null, available: false,
      scope: 'torch-runtime-only', executionStatus: 'not_checked', physicalGpuPresence: null }),
    camera: { status: 'deferred', streamOpened: false, reasonCode: 'check-on-inference-start' } };
  if (id === 'long') {
    const long = '長い名前🧪ABCDEFGHIJKLMNOPQRSTUVWXYZ'.repeat(16);
    report.cpu.data.name += ` ${long} END-CPU`;
    report.gpu.data.adapters.forEach((a, i) => { a.DeviceName += `${long} END-DISPLAY-${i}`; a.DeviceString += `${long} END-GPU-${i}`; });
    report.onnxRuntime.data.providers = report.onnxRuntime.data.providers.map((p, i) => `${p}${long} END-PROVIDER-${i}`);
  }
  if (id === 'whitespace') {
    report.cpu.data.name = '行\u2028'.repeat(39) + '終';
    report.gpu.data.adapters[0].DeviceName = ' A\tB\nC  ';
  }
  if (id === 'error') {
    report.status = 'error';
    for (const name of ['os', 'cpu', 'memory', 'disk', 'gpu', 'onnxRuntime', 'cuda']) {
      report[name] = { status: 'error', data: null, error: { code: `${name}-probe-failed`, causeType: 'OSError' } };
    }
  }
  return report;
}
async function buildFixture(output) {
  const input = join(output, 'fixture'), virtual = join(root, 'tests/manual/__ui-diagnostics-fixture__.tsx').replaceAll('\\', '/');
  mkdirSync(input);
  const source = `import React from 'react'; import {createRoot} from 'react-dom/client';
    import ${JSON.stringify(join(root, 'src/renderer/styles/global.css').replaceAll('\\', '/'))};
    import {DiagnosticsPage} from ${JSON.stringify(join(root, `${component}.tsx`).replaceAll('\\', '/'))};
    const reports = ${JSON.stringify(Object.fromEntries(['normal', 'long', 'whitespace', 'error'].map((id) => [id, fixture(id)])))};
    const root = createRoot(document.getElementById('root')!); let revision = 0;
    const state = {fixtureID:'normal', collects:0, backs:0, rejectNext:false, rendererErrors:0};
    const api = {collect:async () => { state.collects++;
      if (state.rejectNext) { state.rejectNext=false; throw new Error('fixture rejection'); }
      return structuredClone(reports[state.fixtureID]); }};
    function mount(fixtureID) { state.fixtureID=fixtureID; state.collects=0; state.backs=0; state.rejectNext=false;
      root.render(<div className="app-shell"><header className="app-shell__header">
        <span className="app-shell__brand">UIR066 component fixture</span></header>
        <main className="app-shell__main"><DiagnosticsPage key={++revision} api={api} onBack={()=>{state.backs++;}} /></main>
        <footer className="app-shell__footer">${label}</footer></div>); }
    Object.assign(window, {__uiDiagnosticsFixture:{state,mount}});
    window.addEventListener('error',()=>{state.rendererErrors++;});
    window.addEventListener('unhandledrejection',()=>{state.rendererErrors++;}); mount('normal');`;
  writeFileSync(join(input, 'index.html'), `<!doctype html><html lang="ja"><head><meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'self'; base-uri 'none'; form-action 'none'">
    <title>UIR066 component fixture</title></head><body><div id="root" aria-label="${label}"></div>
    <script type="module" src="/ui-diagnostics-fixture.tsx"></script></body></html>`, { flag: 'wx' });
  const { build } = await import('vite'), { default: react } = await import('@vitejs/plugin-react');
  await build({ configFile: false, envFile: false, root: input, base: './', publicDir: false,
    cacheDir: join(output, 'vite-cache'), plugins: [{ name: 'isolated-diagnostics-fixture', enforce: 'pre',
      resolveId(id) { if (id === '/ui-diagnostics-fixture.tsx' || id === virtual) return virtual; },
      load(id) { if (id === virtual) return source; } }, react()],
    build: { outDir: join(output, 'site'), emptyOutDir: false, reportCompressedSize: false } });
}

// Inspect every rendered text fragment, not merely element visibility or textContent.
async function measure(reflow, expected) {
  const frame = () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
  const html = document.documentElement, body = document.body;
  const dialog = document.querySelector('.diagnostics-page__value-dialog[open]'), scope = dialog ?? document.querySelector('main');
  const visible = (e) => !!e && scope.contains(e) && e.getClientRects().length > 0
    && !e.closest('[hidden],[inert],svg') && getComputedStyle(e).visibility === 'visible';
  const fits = (r) => r.width > 0 && r.height > 0 && r.x >= -1 && r.y >= -1 && r.right <= html.clientWidth + 1 && r.bottom <= innerHeight + 1;
  const hit = (e, r) => { const target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return target === e || e.contains(target); };
  const clipped = (e, r) => {
    const value = { x: false, y: false };
    for (let a = e; a && a !== body; a = a.parentElement) {
      const style = getComputedStyle(a), box = a.getBoundingClientRect(), x = box.x + a.clientLeft, y = box.y + a.clientTop;
      if (style.overflowX !== 'visible' && (r.x < x - 1 || r.right > x + a.clientWidth + 1)) value.x = true;
      if (style.overflowY !== 'visible' && (r.y < y - 1 || r.bottom > y + a.clientHeight + 1)) value.y = true;
      // A native top-layer dialog is not clipped by its inert main/grid ancestors.
      if (a === dialog) break;
    }
    return value;
  };
  const position = () => ({ scrollY, scrollX, scopeScrollTop: dialog ? dialog.scrollTop : scrollY, scopeScrollLeft: dialog ? dialog.scrollLeft : scrollX });
  const reachable = (e, r) => { const c = clipped(e, r); return fits(r) && !c.x && !c.y && hit(e, r); };
  const scrollToY = async (y) => {
    const top = Math.max(0, y);
    if (Math.abs(position().scopeScrollTop - top) < 1) return;
    (dialog ?? window).scrollTo({ left: 0, top, behavior: 'instant' }); await frame();
  };
  const reveal = async (r) => {
    const center = dialog ? dialog.getBoundingClientRect().y + dialog.clientTop + dialog.clientHeight / 2 : innerHeight / 2;
    await scrollToY(position().scopeScrollTop + r.y + r.height / 2 - center);
  };
  const initialPosition = position();
  if (reflow) await scrollToY(0); // Normal views must fit without any scroll normalization.
  const result = { viewport: { width: innerWidth, height: innerHeight, clientWidth: html.clientWidth, devicePixelRatio },
    scroll: { documentWidth: html.scrollWidth, documentHeight: html.scrollHeight, bodyWidth: body.scrollWidth, bodyHeight: body.scrollHeight },
    scope: dialog ? 'dialog' : 'main', initialPosition,
    modal: dialog ? { rect: dialog.getBoundingClientRect().toJSON(), inViewport: fits(dialog.getBoundingClientRect()),
      nativeModal: dialog instanceof HTMLDialogElement && dialog.matches(':modal'),
      clientWidth: dialog.clientWidth, clientHeight: dialog.clientHeight, scrollWidth: dialog.scrollWidth, scrollHeight: dialog.scrollHeight } : null,
    theme: { dark: matchMedia('(prefers-color-scheme: dark)').matches, background: getComputedStyle(body).backgroundColor },
    documentFocused: document.hasFocus(), visibilityState: document.visibilityState,
    fixtureLabel: document.getElementById('root').getAttribute('aria-label'),
    headings: [...document.querySelectorAll('main h1')].map((e) => e.textContent.trim()), controls: [],
    localOverflow: [scope, ...scope.querySelectorAll('*')].filter((e) => visible(e) && e.clientWidth > 0 && e.clientHeight > 0)
      .filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)
      .map((e) => ({ tag: e.tagName, className: e.className, isScope: e === scope,
        clientWidth: e.clientWidth, clientHeight: e.clientHeight, scrollWidth: e.scrollWidth, scrollHeight: e.scrollHeight,
        x: e.scrollWidth > e.clientWidth + 1, y: e.scrollHeight > e.clientHeight + 1 })),
    text: { fragments: 0, unreachable: 0, examples: [], retained: expected.map(([selector, value]) => {
      const e = scope.querySelector(selector), actual = e?.textContent;
      return { selector, expectedLength: value.length, actualLength: actual?.length ?? 0, matches: !!e && visible(e) && actual === value };
    }) } };
  if (dialog) {
    const e = dialog.querySelector('p.diagnostics-page__full-value');
    if (e) {
      const range = document.createRange(); range.selectNodeContents(e); const r = range.getBoundingClientRect();
      result.text.fullValue = { rect: r.toJSON(), elementRect: e.getBoundingClientRect().toJSON(),
        hit: hit(e, r), inViewport: fits(r), clipped: clipped(e, r), ...position() };
    }
  }
  for (const e of [...scope.querySelectorAll('button')].filter(visible)) {
    const initialRect = e.getBoundingClientRect().toJSON();
    if (reflow && !reachable(e, initialRect)) await reveal(initialRect);
    const r = e.getBoundingClientRect();
    result.controls.push({ label: e.getAttribute('aria-label') || e.textContent.trim(), disabled: e.disabled,
      initialRect, rect: r.toJSON(), hit: hit(e, r), inViewport: fits(r), clipped: clipped(e, r), ...position() });
  }
  const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const e = node.parentElement;
    if (!node.textContent.trim() || !visible(e)) continue;
    const range = document.createRange(); range.selectNodeContents(node);
    const count = range.getClientRects().length;
    for (let i = 0; i < count; i++) {
      let r = range.getClientRects()[i];
      if (reflow && !reachable(e, r)) { await reveal(r); r = range.getClientRects()[i]; }
      // Chromium includes a zero-width, positive-height rectangle for a literal
      // line break. Verify its exact source range instead of ignoring all zero-width text.
      const lineBreak = r.width === 0 && [...node.textContent.matchAll(/[\r\n\u2028\u2029]/gu)].some((match) => {
        const breakRange = document.createRange();
        breakRange.setStart(node, match.index); breakRange.setEnd(node, match.index + match[0].length);
        return [...breakRange.getClientRects()].some((part) => part.width === 0 && part.height > 0
          && part.x === r.x && part.y === r.y && part.height === r.height);
      });
      const inViewport = fits(r) || (lineBreak && r.height > 0 && r.x >= -1 && r.y >= -1
        && r.right <= html.clientWidth + 1 && r.bottom <= innerHeight + 1);
      const clip = clipped(e, r), at = position();
      result.text.fragments++;
      if (e.closest('.diagnostics-page__full-value')) {
        (result.text.valueFragments ??= []).push({ rect: r.toJSON(), lineBreak, clipped: clip, hit: hit(e, r), inViewport, ...at });
      }
      if (!inViewport || clip.x || clip.y || !hit(e, r) || at.scrollX !== 0 || at.scopeScrollLeft !== 0) {
        result.text.unreachable++;
        if (result.text.examples.length < 12) result.text.examples.push({ tag: e.tagName, rect: r.toJSON(), clipped: clip, ...at });
      }
    }
  }
  if (reflow) await scrollToY(0);
  result.finalPosition = position(); return result;
}

async function inspectFixture(output, deadline) {
  const { app, BrowserWindow, nativeTheme } = createRequire(import.meta.url)('electron');
  assert.equal(app.isReady(), false, 'Profile isolation must precede Electron ready');
  for (const name of ['userData', 'sessionData', 'crashDumps']) {
    const path = join(output, name === 'userData' ? 'profile' : name); mkdirSync(path); app.setPath(name, path);
  }
  app.setAppLogsPath(join(output, 'logs'));
  for (const name of ['disable-background-networking', 'disable-component-update']) app.commandLine.appendSwitch(name);
  app.commandLine.appendSwitch('host-resolver-rules', 'MAP * ~NOTFOUND');
  const evidence = JSON.parse(readFileSync(join(output, 'result.json'), 'utf8'));
  evidence.runtime.electron = process.versions;
  let window, previous, timer, closing = false, currentName = 'startup';
  const finish = (failure) => {
    if (closing) return; closing = true; clearTimeout(timer);
    if (failure) evidence.failures.push(`${currentName}: ${failure}`);
    evidence.sourceHashesAfter = hashes();
    if (JSON.stringify(evidence.sourceHashesAfter) !== JSON.stringify(evidence.sourceHashesBefore)) evidence.failures.push('Source changed');
    if (evidence.cases.length !== 48 || evidence.rendererErrors || evidence.blockedRequests || evidence.permissionRequests) evidence.failures.push('Incomplete cases or unexpected renderer/device/network operation');
    if (new Set(evidence.cases.map((c) => c.name)).size !== evidence.cases.length) evidence.failures.push('Duplicate case name');
    const inspections = evidence.cases.flatMap((c) => c.valueInspections ?? []);
    evidence.valueCoverage = { entries: inspections.length, visited: inspections.filter((v) => v.mode === 'visit').length,
      reused: inspections.filter((v) => v.mode === 'reuse').length, pages: inspections.reduce((n, v) => n + v.pages.length, 0) };
    if (JSON.stringify(evidence.valueCoverage) !== JSON.stringify({ entries: 72, visited: 48, reused: 24, pages: 236 })
      || inspections.some((v) => v.status !== 'PASS' || !v.exactMatches || !v.allPagesChecked)) evidence.failures.push('Incomplete full-value verification');
    evidence.status = evidence.failures.length || evidence.cases.some((c) => c.status !== 'PASS') ? 'FAIL' : 'FIXTURE_ONLY_PASS';
    evidence.elapsedMs = Date.now() - evidence.startedEpochMs; save(output, evidence);
    const fallback = setTimeout(() => { evidence.status = 'FAIL'; evidence.failures.push('Forced self quit'); save(output, evidence); app.exit(1); }, 1500);
    app.once('will-quit', (event) => { event.preventDefault(); clearTimeout(fallback);
      evidence.gracefulWillQuit = true; save(output, evidence); app.exit(evidence.status === 'FIXTURE_ONLY_PASS' ? 0 : 1); });
    app.quit();
  };
  timer = setTimeout(() => finish('Inspection watchdog'), Math.max(1, Math.min(110_000, deadline - Date.now())));
  process.on('message', (message) => { if (message === 'stop') finish('Launcher requested stop'); });
  app.on('window-all-closed', () => { if (!closing) finish('Fixture window closed early'); });
  try {
    await app.whenReady();
    window = new BrowserWindow({ width: 1280, height: 640, useContentSize: true, show: false, autoHideMenuBar: true,
      webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, backgroundThrottling: false } });
    window.removeMenu();
    const wc = window.webContents, site = join(output, 'site');
    wc.session.setPermissionCheckHandler(() => false);
    wc.session.setPermissionRequestHandler((_contents, _permission, callback) => { evidence.permissionRequests++; callback(false); });
    wc.session.webRequest.onBeforeRequest((details, callback) => {
      let allowed = false;
      try { const path = relative(site, fileURLToPath(details.url)); allowed = !isAbsolute(path) && path !== '..' && !path.startsWith('..\\') && !path.startsWith('../'); } catch { /* Non-file requests stay denied. */ }
      if (!allowed) evidence.blockedRequests++; callback({ cancel: !allowed });
    });
    wc.setWindowOpenHandler(() => { evidence.blockedRequests++; return { action: 'deny' }; });
    wc.on('will-navigate', (event) => { event.preventDefault(); evidence.blockedRequests++; });
    wc.on('console-message', (details) => { if (details.level === 'error') evidence.rendererErrors++; });
    wc.on('render-process-gone', () => finish('Renderer exited'));
    const js = (fn, ...args) => wc.executeJavaScript(`(${fn.toString()})(...${JSON.stringify(args)})`);
    const settle = () => js(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const key = async (keyCode, modifiers = []) => {
      wc.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
      if (keyCode === 'Enter' || keyCode === 'Space') wc.sendInputEvent({ type: 'char', keyCode, modifiers });
      wc.sendInputEvent({ type: 'keyUp', keyCode, modifiers }); await settle();
    };
    const isFocused = (selector) => js((s) => document.activeElement.matches(s), selector);
    const focusPoint = (selector, wait = true) => js(async (s, waitForScroll) => {
      for (let attempt = 0; attempt < 90; attempt++) {
        const e = document.querySelector(s), r = e.getBoundingClientRect(), target = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
        const dialog = document.querySelector('.diagnostics-page__value-dialog[open]');
        let clipped = false;
        for (let a = e; a && a !== document.body; a = a.parentElement) {
          const style = getComputedStyle(a), box = a.getBoundingClientRect(), x = box.x + a.clientLeft, y = box.y + a.clientTop;
          if (style.overflowX !== 'visible' && (r.x < x - 1 || r.right > x + a.clientWidth + 1)) clipped = true;
          if (style.overflowY !== 'visible' && (r.y < y - 1 || r.bottom > y + a.clientHeight + 1)) clipped = true;
          if (a === dialog) break;
        }
        const value = { rect: r.toJSON(), scrollY, scrollX, dialogScrollTop: dialog?.scrollTop ?? null, dialogScrollLeft: dialog?.scrollLeft ?? null,
          focused: document.activeElement === e && document.hasFocus(), disabled: e.disabled, clipped,
          reachable: !clipped && (!dialog || dialog.contains(e)) && r.width > 0 && r.height > 0 && r.x >= -1 && r.y >= -1
            && r.right <= document.documentElement.clientWidth + 1 && r.bottom <= innerHeight + 1 && (target === e || e.contains(target)) };
        if (value.reachable || attempt === 89 || !value.focused || !waitForScroll) return value;
        await new Promise((done) => requestAnimationFrame(done));
      }
    }, selector, wait);
    const focusWithTab = async (selector) => {
      for (let n = 0; n < 32; n++) {
        await key('Tab'); // Reenter natively even if measurement scrolled the focused target away.
        if (await isFocused(selector)) {
          const point = await focusPoint(selector);
          evidence.keyboardFocus.push({ case: currentName, selector, ...point });
          assert.ok(point.focused && point.reachable, `Native focus unreachable: ${selector}`); return;
        }
      }
      throw new Error(`Native Tab did not reach ${selector}`);
    };
    const ready = (wanted) => js(async (text) => {
      for (let n = 0; n < 90; n++) {
        if (window.__uiDiagnosticsFixture.state.collects > 0 && document.querySelector('[role=status]')?.textContent.startsWith(text) && !document.querySelector('[aria-busy=true]')) return;
        await new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done)));
      }
      throw new Error('Fixture did not reach requested status');
    }, wanted);
    const device = '[role=tab][id$="-tab-0"]', runtime = '[role=tab][id$="-tab-1"]';
    const back = '.diagnostics-page__header button', retry = '.diagnostics-page__toolbar button';
    const selected = (s) => js((selector) => document.querySelector(selector)?.getAttribute('aria-selected') === 'true', s);
    const activate = async (s) => { await focusWithTab(s); await key('Enter'); };
    const selectTab = async (tab) => { await focusWithTab('[role=tab][tabindex="0"]'); await key(tab ? 'End' : 'Home'); await key('Enter'); assert.ok(await selected(tab ? runtime : device)); };
    const capture = async (record, signature) => {
      const changed = previous && previous.signature !== signature;
      let png, lastHash, stable = false;
      for (record.captureAttempts = 1; record.captureAttempts <= 8; record.captureAttempts++) {
        wc.invalidate(); await settle(); const image = await wc.capturePage(); assert.equal(image.isEmpty(), false);
        png = image.toPNG(); const hash = sha256(png);
        if (hash === lastHash && (!changed || hash !== previous.hash)) { stable = true; break; } lastHash = hash;
      }
      record.captureAttempts = Math.min(record.captureAttempts, 8); record.screenshotStable = stable;
      record.screenshot = `${record.name}.png`; record.screenshotSha256 = sha256(png);
      writeFileSync(join(output, record.screenshot), png, { flag: 'wx' }); assert.equal(sha256(readFileSync(join(output, record.screenshot))), record.screenshotSha256);
      assert.ok(stable, 'Capture did not stabilize/change within 8 attempts'); previous = { signature, hash: record.screenshotSha256 };
    };
    const modal = '.diagnostics-page__value-dialog[open]', fullValue = 'p.diagnostics-page__full-value';
    const valuePrev = `${modal} [aria-label="全文: 前のページ"]`, valueNext = `${modal} [aria-label="全文: 次のページ"]`;
    const valueClose = `${modal} [aria-label="全文を閉じる"]`, completedValues = new Map(), verifiedViews = new Set();
    const modalOpen = () => js(() => !!document.querySelector('dialog[open]'));
    const valueState = () => js((s) => {
      const d = document.querySelector(s), p = d?.querySelector('p.diagnostics-page__full-value');
      const prev = d?.querySelector('[aria-label="全文: 前のページ"]'), next = d?.querySelector('[aria-label="全文: 次のページ"]');
      const saved = window.__uiDiagnosticsFixture.inspectionReturn;
      return { text: p?.textContent, counter: d?.querySelector('.diagnostics-page__value-pages span')?.textContent,
        previousDisabled: prev?.disabled, nextDisabled: next?.disabled,
        pagerTargetsValue: !!p?.id && prev?.getAttribute('aria-controls') === p.id && next?.getAttribute('aria-controls') === p.id,
        selectedUnchanged: saved.selected === document.querySelector('[role=tab][aria-selected=true]')?.id,
        collectsUnchanged: saved.collects === window.__uiDiagnosticsFixture.state.collects,
        title: d && document.getElementById(d.getAttribute('aria-labelledby'))?.textContent };
    }, modal);
    const valueAction = async (selector, record) => {
      // A measurement may leave the focused pager offscreen; waiting cannot reveal it.
      let point = await focusPoint(selector, false), route = 'focused-enter';
      if (!point.focused || !point.reachable) { await focusWithTab(selector); point = await focusPoint(selector, false); route = 'tab-enter'; }
      record.actions.push({ selector, route, ...point });
      assert.ok(point.focused && point.reachable && !point.disabled, `Value action unreachable: ${selector}`);
      if (!record.allowVerticalScroll) assert.ok(point.scrollY === 0 && point.scrollX === 0 && point.dialogScrollTop === 0 && point.dialogScrollLeft === 0, 'Normal action scrolled');
      await key('Enter');
    };
    const inspectValue = async (item, selector, value) => {
      const verificationKey = JSON.stringify([item.fixtureID, item.view, item.tab, selector, value]), completed = completedValues.get(verificationKey);
      if (completed) {
        assert.ok(completed.record.status === 'PASS' && completed.record.exactMatches && completed.record.allPagesChecked);
        item.valueInspections.push({ verificationKey, selector, expectedValue: value, mode: 'reuse', nativeOpenThisCase: false,
          reusedFrom: { case: completed.case, verificationKey: completed.record.verificationKey }, pages: [],
          verifiedPageCount: completed.record.pages.length, exactMatches: true, allPagesChecked: true, status: 'PASS' }); return;
      }
      const record = { verificationKey, selector, expectedValue: value, mode: 'visit', nativeOpenThisCase: false,
        allowVerticalScroll: item.allowVerticalScroll, pages: [], openings: [], actions: [], closes: [], status: 'RUNNING' };
      item.valueInspections.push(record);
      const trigger = `${selector} button[aria-haspopup="dialog"]`, viewKey = JSON.stringify(item.view), firstInView = !verifiedViews.has(viewKey);
      const title = selector.includes('"CPU"') ? '名前' : selector.includes('"実行プロバイダー"') ? '実行プロバイダー'
        : selector.includes('first-child') ? 'デバイス名（DeviceName）' : 'アダプター名（DeviceString）';
      const segments = [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(value)].map((s) => s.segment), expectedPages = [];
      for (let cursor = 0; cursor < segments.length;) {
        const start = cursor; let breaks = 0;
        while (cursor < segments.length && cursor - start < 120 && breaks < 6) { if (/[\r\n\u2028\u2029]/u.test(segments[cursor])) breaks++; cursor++; }
        expectedPages.push(segments.slice(start, cursor).join(''));
      }
      record.expectedPageCount = expectedPages.length;
      try {
        assert.ok(value.length < 600 && expectedPages.length > 0 && expectedPages.length <= 32, 'Fixture exceeds bounded page budget');
        await js((s) => { window.__uiDiagnosticsFixture.inspectionReturn = { trigger: document.querySelector(s),
          selected: document.querySelector('[role=tab][aria-selected=true]')?.id, collects: window.__uiDiagnosticsFixture.state.collects }; }, trigger);
        const open = async () => {
          await activate(trigger);
          const state = await js((s) => {
            const d = document.querySelector(s), saved = window.__uiDiagnosticsFixture.inspectionReturn;
            return { dialogCount: document.querySelectorAll('.diagnostics-page__value-dialog').length,
              openCount: document.querySelectorAll('dialog[open]').length, modalCount: document.querySelectorAll('dialog:modal').length,
              nativeModal: d instanceof HTMLDialogElement && d.matches(':modal'), rootOwned: d?.parentElement.matches('.diagnostics-page'),
              initialFocusInside: !!d?.contains(document.activeElement) && document.hasFocus(), initialFocusTag: document.activeElement.tagName,
              selectedUnchanged: saved.selected === document.querySelector('[role=tab][aria-selected=true]')?.id,
              collectsUnchanged: saved.collects === window.__uiDiagnosticsFixture.state.collects,
              scrollY, scrollX, dialogScrollTop: d?.scrollTop, dialogScrollLeft: d?.scrollLeft };
          }, modal);
          record.openings.push(state); record.nativeOpenThisCase ||= state.nativeModal;
          assert.ok(state.dialogCount === 1 && state.openCount === 1 && state.modalCount === 1 && state.nativeModal && state.rootOwned, 'Expected one native root modal');
          assert.ok(state.initialFocusInside && state.selectedUnchanged && state.collectsUnchanged, 'Native initial focus or underlying context changed');
          if (!item.allowVerticalScroll) assert.ok(state.scrollY === 0 && state.scrollX === 0 && state.dialogScrollTop === 0 && state.dialogScrollLeft === 0, 'Normal opening scrolled');
        };
        const close = async (method) => {
          if (method === 'Escape') await key('Escape'); else await valueAction(valueClose, record);
          const state = await js((s) => {
            const saved = window.__uiDiagnosticsFixture.inspectionReturn;
            return { closed: !document.querySelector('dialog[open]'), sameTrigger: saved.trigger === document.querySelector(s) && document.activeElement === saved.trigger,
              selectedUnchanged: saved.selected === document.querySelector('[role=tab][aria-selected=true]')?.id,
              collectsBefore: saved.collects, collectsAfter: window.__uiDiagnosticsFixture.state.collects };
          }, trigger);
          const point = await focusPoint(trigger); record.closes.push({ method, ...state, focus: point });
          assert.ok(state.closed && state.sameTrigger && state.selectedUnchanged && state.collectsBefore === state.collectsAfter && point.focused && point.reachable, 'Close did not restore the same reachable trigger/context');
          if (!item.allowVerticalScroll) assert.ok(point.scrollY === 0 && point.scrollX === 0, 'Normal close scrolled');
        };
        await open();
        if (firstInView) {
          const trapState = () => js((s) => {
            const d = document.querySelector(s), controls = [...d.querySelectorAll('button:not(:disabled), [tabindex="0"]')];
            return { inside: d.contains(document.activeElement) && document.hasFocus(), index: controls.indexOf(document.activeElement),
              count: controls.length, tag: document.activeElement.tagName, rect: document.activeElement.getBoundingClientRect().toJSON(),
              scrollY, scrollX, dialogScrollTop: d.scrollTop, dialogScrollLeft: d.scrollLeft };
          }, modal);
          let state = await trapState(); record.tabTrap = { initial: state, steps: [] };
          assert.ok(state.inside && state.index >= 0 && state.count >= 3 && state.count <= 8, 'Unexpected modal tab order');
          const count = state.count;
          for (const direction of [1, -1]) for (let step = 0; step <= count; step++) {
            const index = (state.index + direction + count) % count;
            await key('Tab', direction < 0 ? ['shift'] : []); state = await trapState(); record.tabTrap.steps.push({ direction, ...state });
            assert.ok(state.inside && state.count === count && state.index === index, 'Native Tab/Shift+Tab escaped modal or skipped a control');
            if (!item.allowVerticalScroll) assert.ok(state.scrollY === 0 && state.scrollX === 0 && state.dialogScrollTop === 0 && state.dialogScrollLeft === 0, 'Normal tab trap scrolled');
          }
        }
        const seen = new Set();
        for (let index = 0; index < expectedPages.length; index++) {
          const state = await valueState(), page = { number: index + 1, ...state, status: 'RUNNING' }; record.pages.push(page);
          page.graphemes = [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(state.text ?? '')].length;
          page.lineBreaks = [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(state.text ?? '')].filter((s) => /[\r\n\u2028\u2029]/u.test(s.segment)).length;
          page.exactMatches = state.text === expectedPages[index];
          assert.ok(!seen.has(state.counter) && state.counter === `${index + 1} / ${expectedPages.length}`, 'Pager stalled, repeated, or skipped a page'); seen.add(state.counter);
          assert.ok(page.exactMatches && page.graphemes > 0 && page.graphemes <= 120 && page.lineBreaks <= 6 && state.title === title, 'Full-value page/title differs');
          assert.ok(state.selectedUnchanged && state.collectsUnchanged, 'Page navigation changed underlying tab/API count');
          assert.ok(state.previousDisabled === (index === 0) && state.nextDisabled === (index === expectedPages.length - 1) && state.pagerTargetsValue, 'Pager bounds/target differs');
          const m = page.metrics = await js(measure, item.allowVerticalScroll, [[fullValue, expectedPages[index]]]);
          assert.ok(m.scope === 'dialog' && m.modal?.nativeModal && m.modal.inViewport && m.documentFocused && m.visibilityState === 'visible', 'Modal bounds/focus');
          assert.ok(m.scroll.documentWidth <= m.viewport.clientWidth + 1 && m.scroll.bodyWidth <= m.viewport.clientWidth + 1
            && m.modal.scrollWidth <= m.modal.clientWidth + 1 && m.localOverflow.every((e) => !e.x && (!e.y || (item.allowVerticalScroll && e.isScope))), 'Modal/local horizontal or forbidden vertical overflow');
          assert.ok(m.initialPosition.scrollY === m.finalPosition.scrollY && m.initialPosition.scrollX === 0 && m.finalPosition.scrollX === 0
            && m.initialPosition.scopeScrollLeft === 0 && m.finalPosition.scopeScrollLeft === 0, 'Modal measurement scrolled the document/horizontally');
          assert.ok(m.controls.length === 3 && m.controls.every((c) => c.hit && c.inViewport && !c.clipped.x && !c.clipped.y && c.scrollX === 0 && c.scopeScrollLeft === 0), 'Dialog controls clipped/unreachable');
          assert.ok(m.text.fragments > 0 && m.text.valueFragments?.length > 0 && !m.text.unreachable && m.text.retained.every((t) => t.matches), 'Dialog text clipped/obscured/unreachable');
          if (!item.allowVerticalScroll) {
            assert.ok(m.scroll.documentHeight <= m.viewport.height + 1 && m.scroll.bodyHeight <= m.viewport.height + 1 && m.modal.scrollHeight <= m.modal.clientHeight + 1, 'Normal modal/document vertical overflow');
            assert.ok(m.initialPosition.scrollY === 0 && m.finalPosition.scrollY === 0 && m.initialPosition.scopeScrollTop === 0 && m.finalPosition.scopeScrollTop === 0
              && m.controls.every((c) => c.scrollY === 0 && c.scopeScrollTop === 0), 'Normal modal/document scrolled');
            assert.ok(m.text.fullValue?.hit && m.text.fullValue.inViewport && !m.text.fullValue.clipped.x && !m.text.fullValue.clipped.y, 'Whole page text does not fit');
          }
          if (item.fixtureID === 'long' && item.tab === 0 && item.view[0] === 1280 && item.view[1] === 640 && item.view[2] === 1
            && (index === 0 || index === expectedPages.length - 1)) {
            page.name = `${item.name}-value-cpu-page${index + 1}`; await capture(page, JSON.stringify([m.viewport, m.theme, page.name]));
          }
          page.status = 'PASS'; save(output, evidence);
          if (index + 1 < expectedPages.length) await valueAction(valueNext, record);
        }
        record.reconstructedValue = record.pages.map((p) => p.text).join(''); record.exactMatches = record.reconstructedValue === value;
        record.allPagesChecked = record.pages.length === expectedPages.length && record.pages.every((p) => p.status === 'PASS');
        assert.ok(record.exactMatches && record.allPagesChecked, 'Full value was not reconstructed exactly');
        if (firstInView && expectedPages.length > 1) {
          record.pagerRoundTrip = [];
          for (const [action, index] of [[valuePrev, expectedPages.length - 2], [valueNext, expectedPages.length - 1]]) {
            await valueAction(action, record); const state = await valueState(); record.pagerRoundTrip.push({ ...state, reusedCheckedPage: index + 1 });
            assert.ok(state.text === expectedPages[index] && state.counter === `${index + 1} / ${expectedPages.length}` && state.title === title, 'Native previous/next round trip differs');
          }
        }
        await close(firstInView ? 'Escape' : 'explicit');
        if (firstInView) {
          await open(); record.reopenedPage = await valueState();
          assert.ok(record.reopenedPage.text === expectedPages[0] && record.reopenedPage.counter === `1 / ${expectedPages.length}`, 'Reopening did not reset to first page');
          await close('explicit'); verifiedViews.add(viewKey);
        }
        record.status = 'PASS';
      } catch (error) {
        record.status = 'FAIL'; record.failure = error.message;
        for (const page of record.pages.filter((p) => p.status === 'RUNNING')) { page.status = 'FAIL'; page.failure = error.message; }
        throw error;
      }
    };
    await window.loadFile(join(site, 'index.html')); window.show(); window.focus(); wc.focus();
    await js(async () => { await document.fonts.ready; }); await settle();
    const views = [[1280, 640, 1, 'light'], [1280, 640, 1, 'dark'], [1280, 640, 2, 'light'],
      [1280, 640, 2, 'dark'], [1024, 600, 1, 'light'], [1024, 600, 1, 'dark']];
    for (const [fixtureID, view] of [...views.map((v) => ['normal', v]),
      ...[views[0], views[1], views[3], views[4]].map((v) => ['long', v]),
      ...[views[0], views[1]].map((v) => ['whitespace', v]), ...[views[0], views[3], views[4]].map((v) => ['error', v])]) {
      const [width, height, zoom, theme] = view, prefix = `${fixtureID}-${theme}-${width}x${height}-z${zoom * 100}`;
      currentName = prefix; window.setContentSize(width, height); wc.setZoomFactor(zoom); nativeTheme.themeSource = theme;
      await js((id) => window.__uiDiagnosticsFixture.mount(id), fixtureID); await ready(fixtureID === 'error' ? '取得失敗' : '取得済み');
      for (const tab of [0, 1]) {
        await selectTab(tab);
        for (let page = 0; page < (fixtureID === 'long' && tab === 1 ? 4 : 1); page++) {
          currentName = `${prefix}-${tab ? `runtime-gpu${page + 1}` : 'device'}`;
          const item = { name: currentName, fixtureID, tab, gpuPage: page, view, failures: [], valueInspections: [] }, start = Date.now(); evidence.cases.push(item);
          try {
            const report = fixture(fixtureID), bytes = (n) => `${n.toLocaleString('ja-JP')} B`;
            const expected = fixtureID === 'error' ? [['[role=status]', '取得失敗 — 再取得してください。']] : tab === 0
              ? [['[aria-label="CPU"] dd', report.cpu.data.name],
                ...['totalBytes', 'availableBytes'].map((p, i) => [`[aria-label="メモリ"] dl > div:nth-child(${i + 1}) dd`, bytes(report.memory.data[p])]),
                ...['totalBytes', 'usedBytes', 'freeBytes'].map((p, i) => [`[aria-label="ディスク"] dl > div:nth-child(${i + 1}) dd`, bytes(report.disk.data[p])])]
              : [['[aria-label="GPU"] dl > div:first-child dd', report.gpu.data.adapters[page].DeviceName],
                ['[aria-label="GPU"] dl > div:nth-child(2) dd', report.gpu.data.adapters[page].DeviceString],
                ...report.onnxRuntime.data.providers.map((p, i) => [`[aria-label="実行プロバイダー"] li:nth-child(${i + 1})`, p])];
            const reflow = zoom === 2 || width === 1024; item.allowVerticalScroll = reflow;
            const triggers = await js((pairs) => pairs.map(([selector]) => ({ selector,
              count: document.querySelectorAll(`${selector} button[aria-haspopup="dialog"]`).length })), expected);
            item.valueTriggers = triggers;
            const cells = expected.map(([selector, value], index) => [selector, triggers[index].count ? '全文を表示' : value]);
            const m = item.metrics = await js(measure, reflow, cells), check = (ok, why) => { if (!ok) item.failures.push(why); };
            check(Math.abs(m.viewport.width - width / zoom) <= 1 && Math.abs(m.viewport.height - height / zoom) <= 1, 'Viewport differs from requested size');
            check(m.documentFocused && m.visibilityState === 'visible' && m.theme.dark === (theme === 'dark'), 'Focus/visibility/theme');
            check(m.fixtureLabel === label && JSON.stringify(m.headings) === JSON.stringify(['端末・容量']), 'Fixture boundary or doubled heading');
            check(m.scroll.documentWidth <= m.viewport.clientWidth + 1 && m.scroll.bodyWidth <= m.viewport.clientWidth + 1, 'Horizontal document/body overflow');
            if (!reflow) check(m.scroll.documentHeight <= m.viewport.height + 1 && m.scroll.bodyHeight <= m.viewport.height + 1, 'Normal vertical document/body overflow (>1px)');
            check(m.scope === 'main' && m.controls.length >= 4 && m.controls.every((c) => c.hit && c.inViewport && !c.clipped.x && !c.clipped.y && c.scrollX === 0), 'Main control clipped or unreachable');
            check(m.text.fragments > 0 && !m.text.unreachable && m.text.retained.every((t) => t.matches), 'Text lost, clipped, obscured or unreachable');
            if (!reflow) check(!m.localOverflow.length && m.initialPosition.scrollY === 0 && m.finalPosition.scrollY === 0, 'Normal local overflow/scroll');
            await capture(item, JSON.stringify([m.viewport, m.theme]));
            for (const [index, [selector, value]] of expected.entries()) {
              const needsDetail = [...new Intl.Segmenter('ja', { granularity: 'grapheme' }).segment(value)].length > 80
                || value.trim() !== value || /[\t\r\n\u2028\u2029]|\s{2}/u.test(value);
              check(triggers[index].count === (needsDetail ? 1 : 0), `Unexpected full-value trigger count: ${selector}`);
              if (triggers[index].count === 1) await inspectValue(item, selector, value);
            }
            check(item.valueInspections.every((v) => v.status === 'PASS' && v.exactMatches && v.allPagesChecked), 'Incomplete nested value inspections');
          } catch (error) { item.status = 'FAIL'; item.failures.push(error.message); save(output, evidence); }
          finally {
            if (await modalOpen()) {
              item.modalCleanup = { attempted: true }; save(output, evidence);
              try { await key('Escape'); item.modalCleanup.closed = !(await modalOpen());
                if (!item.modalCleanup.closed) { await activate(valueClose); item.modalCleanup.closed = !(await modalOpen()); }
              } catch (error) { item.modalCleanup.failure = error.message; }
              if (!item.modalCleanup.closed) item.failures.push('Failed to close modal before continuing');
              save(output, evidence);
            }
          }
          item.status = item.failures.length ? 'FAIL' : 'PASS'; item.elapsedMs = Date.now() - start; save(output, evidence);
          if (item.modalCleanup && !item.modalCleanup.closed) throw new Error('Modal cleanup blocked subsequent cases');
          if (item.status === 'PASS') for (const record of item.valueInspections.filter((v) => v.mode === 'visit')) {
            completedValues.set(record.verificationKey, { case: item.name, record });
          }
          if (fixtureID === 'long' && tab === 1 && page < 3) await activate('[aria-label="GPU: 次のページ"]');
        }
      }
      if (fixtureID === 'normal') {
        currentName = `${prefix}-native-keyboard`; const item = { name: currentName, fixtureID, view, status: 'PASS' }, start = Date.now();
        try {
          await selectTab(0); await key('Right'); assert.ok(await isFocused(runtime)); assert.ok(await selected(device));
          await key('Tab'); assert.ok(await isFocused('[role=tabpanel]:not([hidden])'));
          await key('Tab', ['shift']); assert.ok(await isFocused(device));
          await key('End'); await key('Enter'); assert.ok(await selected(runtime));
          await key('Home'); await key('Space'); assert.ok(await selected(device));
          await key('Left'); assert.ok(await isFocused(runtime)); assert.ok(await selected(device));
          await key('Space'); assert.ok(await selected(runtime));
          await js(() => { window.__uiDiagnosticsFixture.state.rejectNext = true; }); await activate(retry); await ready('取得失敗');
          assert.ok(await js(() => document.querySelector('.diagnostics-page__previous')?.textContent.includes('最新ではありません')));
          await activate(retry); await ready('取得済み'); await activate(back);
          item.callbacks = await js(() => ({ collects: window.__uiDiagnosticsFixture.state.collects, backs: window.__uiDiagnosticsFixture.state.backs }));
          assert.deepEqual(item.callbacks, { collects: 3, backs: 1 });
        } catch (error) { item.status = 'FAIL'; item.failure = error.message; }
        item.elapsedMs = Date.now() - start; evidence.cases.push(item); save(output, evidence);
      }
    }
    evidence.rendererErrors += await js(() => window.__uiDiagnosticsFixture.state.rendererErrors); finish();
  } catch (error) { finish(error.message); }
}

async function launch() {
  const startedEpochMs = Date.now(), deadline = startedEpochMs + 180_000, node = nativeNode();
  const output = join(root, 'test-results', `ui-diagnostics-${randomUUID()}`); mkdirSync(output, { recursive: true });
  const initial = { status: 'RUNNING', startedEpochMs, startedAt: new Date(startedEpochMs).toISOString(), fixtureRunID: basename(output),
    scope: label, notTested: ['production AppShell integration', 'user acceptance', 'real hardware/model capacity', 'native IME', 'unit tests'],
    expectedCaseCount: 48, hashBasis: 'working-tree bytes, not Git blobs', sourceHashesBefore: hashes(),
    expectedValueCoverage: { entries: 72, visited: 48, reused: 24, pages: 236 }, expectedExtraScreenshots: 4,
    runtime: { nativeNode: process.versions, nodeExecutable: node }, cases: [], failures: [], keyboardFocus: [], rendererErrors: 0, blockedRequests: 0, permissionRequests: 0 };
  save(output, initial); let child; const phases = [];
  const readResult = () => { try { return JSON.parse(readFileSync(join(output, 'result.json'), 'utf8')); } catch { return structuredClone(initial); } };
  const finalize = (failure) => {
    const result = readResult(); result.phases = phases; result.sourceHashesAfter = hashes();
    if (failure) result.failures.push(failure);
    if (JSON.stringify(result.sourceHashesBefore) !== JSON.stringify(result.sourceHashesAfter)) result.failures.push('Source changed');
    if (result.failures.length || result.status !== 'FIXTURE_ONLY_PASS') result.status = 'FAIL';
    result.finishedAt = new Date().toISOString(); result.elapsedMs = Date.now() - startedEpochMs; save(output, result);
    console.log(JSON.stringify({ output, result: join(output, 'result.json'), status: result.status, cases: result.cases.map((c) => ({ name: c.name, status: c.status })) }));
    return result;
  };
  const watchdog = setTimeout(() => { child?.kill('SIGKILL'); finalize('180s launcher watchdog'); process.exit(1); }, Math.max(1, deadline - Date.now()));
  const env = { ...process.env }; for (const name of ['NODE_OPTIONS', 'ELECTRON_RUN_AS_NODE', 'ELECTRON_ENABLE_LOGGING', 'ELECTRON_LOG_FILE']) delete env[name];
  env.TEMP = env.TMP = join(output, 'temp'); mkdirSync(env.TEMP);
  const phase = (name, executable, args, limit) => new Promise((done, fail) => {
    const start = Date.now(); let forced, settled = false, timedOut = false;
    child = spawn(executable, args, { cwd: root, shell: false, env, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
    const timer = setTimeout(() => { timedOut = true; if (child.connected) child.send('stop', () => {});
      forced = setTimeout(() => child?.kill('SIGKILL'), 1500); }, Math.max(1, limit));
    const complete = (error, code, signal) => {
      if (settled) return; settled = true; clearTimeout(timer); clearTimeout(forced); child = undefined;
      phases.push({ name, elapsedMs: Date.now() - start, exitCode: code ?? null, signal: signal ?? null, timedOut });
      if (error || code !== 0 || timedOut) fail(new Error(`${name}: ${timedOut ? 'timeout' : error?.code ?? `exit ${code}`}`)); else done();
    };
    child.once('error', (error) => complete(error)); child.once('exit', (code, signal) => complete(null, code, signal));
  });
  let failure;
  try {
    assert.ok(Object.values(initial.sourceHashesBefore).every(Boolean), 'Unreadable source baseline');
    await phase('build', node, [self, '--build', output], 60_000);
    const electron = realpathSync(createRequire(import.meta.url)('electron'));
    assert.equal(basename(electron).toLowerCase(), 'electron.exe');
    // -- prevents our --inspect argument from opening an Electron debugger port.
    await phase('electron', electron, [self, '--', '--inspect', output, String(deadline - 2000)], Math.min(110_000, deadline - Date.now() - 2000));
  } catch (error) { failure = error.message; }
  finally { clearTimeout(watchdog); process.exitCode = finalize(failure).status === 'FIXTURE_ONLY_PASS' ? 0 : 1; }
}
const args = process.argv.slice(2); if (args[0] === '--') args.shift();
try {
  if (args[0] === '--build') { nativeNode(); process.on('message', (m) => { if (m === 'stop') process.exit(1); }); await buildFixture(checkedOutput(args[1])); process.disconnect?.(); }
  else if (args[0] === '--inspect') { assert.equal(process.type, 'browser', '--inspect requires the launcher');
    const deadline = Number(args[2]); assert.ok(Number.isFinite(deadline));
    // Electron emits ready after the ESM entry finishes evaluating. Do not await
    // a function waiting for app.whenReady() from the top-level module evaluation.
    void inspectFixture(checkedOutput(args[1]), deadline).catch((error) => {
      console.error(`UI_DIAGNOSTICS_FAILURE: ${error.message}`);
      createRequire(import.meta.url)('electron').app.exit(1);
    }); }
  else { assert.equal(args.length, 0, 'Use native node tests/manual/ui-diagnostics-probe.mjs'); await launch(); }
} catch (error) {
  console.error(`UI_DIAGNOSTICS_FAILURE: ${error.message}`); process.exitCode = 1;
  if (process.type === 'browser') createRequire(import.meta.url)('electron').app.exit(1); else process.disconnect?.();
}