import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { release } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { app, nativeTheme, screen } from 'electron';

// One-shot M1 inspection of the real built entry, never a product startup hook.
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const output = join(root, 'test-results', `ui-shell-${randomUUID()}`);
mkdirSync(join(output, 'profile'), { recursive: true });
app.setPath('userData', join(output, 'profile'));
app.setPath('sessionData', join(output, 'profile'));

const evidence = {
  status: 'RUNNING',
  startedAt: new Date().toISOString(),
  platform: process.platform,
  architecture: process.arch,
  osRelease: release(),
  versions: process.versions,
  profileIsolated: true,
  userConfirmation: 'NOT_RUN',
  cases: [],
  checks: [],
  noticeScrollChecks: [],
  keyboardReachability: [],
  rendererErrors: [],
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const sourceFiles = [
  'src/main/index.ts', 'src/main/window.ts',
  'src/renderer/layout/AppShell.tsx', 'src/renderer/layout/WorkflowTabs.tsx',
  'src/renderer/features/settings/SettingsPage.tsx', 'src/renderer/routes.tsx',
  'src/renderer/styles/tokens.css', 'src/renderer/styles/global.css',
  'src/renderer/components/SystemIcon.tsx', 'package.json', 'package-lock.json',
  'tests/manual/ui-shell-probe.mjs',
];
const bundleFiles = [
  'dist/main/index.js', 'dist/preload/index.cjs', 'dist/renderer/index.html',
  ...readdirSync(join(root, 'dist/renderer/assets')).map((name) => `dist/renderer/assets/${name}`),
];
const hashes = (files) => Object.fromEntries(files.map((path) => [path, sha256(readFileSync(join(root, path)))]));
evidence.sourceHashes = hashes(sourceFiles);
evidence.bundleHashes = hashes(bundleFiles);

let window;
let watchdog;
app.once('quit', (_event, exitCode) => {
  clearTimeout(watchdog);
  evidence.quitExitCode = exitCode;
  evidence.finishedAt = new Date().toISOString();
  writeFileSync(join(output, 'result.json'), JSON.stringify(evidence, null, 2));
  console.log(`UI_SHELL_RESULT=${join(output, 'result.json')}`);
});

const evaluate = (body) => window.webContents.executeJavaScript(`(() => { ${body} })()`);
const settle = () => window.webContents.executeJavaScript(
  'new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',
);

async function click(selector) {
  const point = await evaluate(`
    const e = document.querySelector(${JSON.stringify(selector)});
    if (!e) throw new Error('Missing click target');
    e.scrollIntoView({block: 'nearest'});
    const r = e.getBoundingClientRect();
    return {x: r.x + r.width / 2, y: r.y + r.height / 2};
  `);
  const zoom = window.webContents.getZoomFactor();
  const position = { x: Math.round(point.x * zoom), y: Math.round(point.y * zoom) };
  window.webContents.sendInputEvent({ type: 'mouseMove', ...position });
  window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...position });
  window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...position });
  await settle();
}

async function key(keyCode, modifiers = []) {
  window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
  if (keyCode === 'Enter' || keyCode === 'Space') {
    window.webContents.sendInputEvent({ type: 'char', keyCode, modifiers });
  }
  window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
  await settle();
}

async function focusedControl(selector) {
  const result = await window.webContents.executeJavaScript(`new Promise(resolve => {
    const started = performance.now();
    function observe() {
      const e = document.querySelector(${JSON.stringify(selector)});
      if (!e) throw new Error('Missing keyboard target');
      const r = e.getBoundingClientRect();
      const hit = document.elementFromPoint(r.x+r.width/2,r.y+r.height/2);
      const visible = r.width > 0 && r.height > 0 && r.x >= -1 && r.y >= -1
        && r.right <= document.documentElement.clientWidth+1 && r.bottom <= innerHeight+1
        && (hit === e || e.contains(hit));
      if (visible || performance.now()-started >= 1500) {
        resolve({selector:${JSON.stringify(selector)},focused:document.activeElement === e,
          visible,documentFocused:document.hasFocus(),visibilityState:document.visibilityState,
          viewport:{width:innerWidth,height:innerHeight},scrollY,
          rect:{x:r.x,y:r.y,width:r.width,height:r.height}});
      } else requestAnimationFrame(observe);
    }
    observe();
  })`);
  evidence.keyboardReachability.push(result);
  assert.ok(result.focused && result.visible && result.documentFocused
    && result.visibilityState === 'visible', `Keyboard target not reachable: ${JSON.stringify(result)}`);
}

async function focusWithTab(selector) {
  // Traverse natively; never call focus()/scrollIntoView() to prove reachability.
  for (let count = 0; count < 32; count += 1) {
    await key('Tab');
    if (await evaluate(`return document.activeElement.matches(${JSON.stringify(selector)});`)) {
      await focusedControl(selector);
      return;
    }
  }
  throw new Error(`Tab did not reach ${selector}`);
}

async function activateWithKeyboard(selector) {
  await focusWithTab(selector);
  await key('Enter');
}

async function verifyNoticeEnd(name) {
  const selector = `pre[aria-label="Fluent System Icons ${name}"]`;
  const actual = await evaluate(`return document.querySelector(${JSON.stringify(selector)}).textContent;`);
  const expected = readFileSync(join(root, `resources/licenses/fluent-system-icons.${name}.txt`), 'utf8');
  assert.equal(actual.replace(/\r\n/g, '\n'), expected.replace(/\r\n/g, '\n'));
  await focusWithTab(selector);
  await key('End', ['control']);
  // Keyboard scrolling can animate beyond the two DOM-settlement frames.
  const scrollCheck = await window.webContents.executeJavaScript(`new Promise(resolve => {
    const e = document.querySelector(${JSON.stringify(selector)});
    const start = performance.now();
    const initialScrollTop = e.scrollTop;
    function observe() {
      const reachedEnd = e.scrollTop + e.clientHeight >= e.scrollHeight - 2;
      const elapsedMs = performance.now() - start;
      if (reachedEnd || elapsedMs >= 1500) {
        resolve({name:${JSON.stringify(name)},initialScrollTop,scrollTop:e.scrollTop,
          clientHeight:e.clientHeight,scrollHeight:e.scrollHeight,
          focused:document.activeElement === e,reachedEnd,elapsedMs});
      } else requestAnimationFrame(observe);
    }
    observe();
  })`);
  evidence.noticeScrollChecks.push({ zoom: window.webContents.getZoomFactor(), ...scrollCheck });
  assert.ok(scrollCheck.focused && scrollCheck.reachedEnd, `${name}: keyboard cannot reach end: ${JSON.stringify(scrollCheck)}`);
}

async function inspect(name, allowVerticalScroll = false) {
  assert.ok(!evidence.cases.some((item) => item.name === name), `Duplicate case: ${name}`);
  await settle();
  const measurement = await evaluate(`
    const visible = e => e.getClientRects().length > 0
      && getComputedStyle(e).visibility !== 'hidden'
      && !(e.closest('details:not([open])') && e.tagName !== 'SUMMARY');
    const controls = [...document.querySelectorAll('a,button,summary,pre[tabindex]')]
      .filter(e => visible(e) && !e.classList.contains('skip-link'));
    const bounds = e => {
      const r = e.getBoundingClientRect();
      return {x:r.x,y:r.y,width:r.width,height:r.height,right:r.right,bottom:r.bottom};
    };
    const root = document.documentElement;
    return {
      viewport: {width: innerWidth, height: innerHeight},
      scroll: {width:root.scrollWidth,height:root.scrollHeight,x:scrollX,y:scrollY},
      visibilityState: document.visibilityState,
      documentFocused: document.hasFocus(),
      devicePixelRatio,
      headings: [...document.querySelectorAll('h1,h2')].filter(visible).map(e=>e.textContent),
      controls: controls.map(e=>({id:e.id,label:e.getAttribute('aria-label')||e.textContent.trim(),
        rect:bounds(e),localScroll:e.classList.contains('license-text')})),
      bodyColors: {background:getComputedStyle(document.body).backgroundColor,color:getComputedStyle(document.body).color},
      activeTab: document.querySelector('[role=tab][aria-selected=true]')?.id ?? null,
      focused: document.activeElement.id || document.activeElement.tagName,
      bridgeKeys: Object.keys(window.autoVision ?? {}),
      text: document.querySelector('main').innerText.slice(0, 250)
    };
  `);
  measurement.controls = measurement.controls.map((control) => ({
    ...control,
    // Keep only labels, not the full third-party notice, in the measurements.
    label: control.localScroll ? control.label : control.label.slice(0, 120),
  }));
  const screenshot = `${name}.png`;
  const previous = evidence.cases.at(-1);
  const changedDisplay = previous && (
    previous.measurement.devicePixelRatio !== measurement.devicePixelRatio
    || previous.measurement.viewport.width !== measurement.viewport.width
    || previous.measurement.viewport.height !== measurement.viewport.height
    || previous.measurement.bodyColors.background !== measurement.bodyColors.background
  );
  let png;
  let lastHash;
  let captureAttempts = 0;
  // A DOM paint frame can precede Chromium's composited frame after zoom/theme
  // changes. Require two stable captures and a changed image for display changes.
  for (; captureAttempts < 8; captureAttempts += 1) {
    window.webContents.invalidate();
    await settle();
    const image = await window.webContents.capturePage();
    assert.equal(image.isEmpty(), false, `${name}: empty capture`);
    const candidate = image.toPNG();
    const hash = sha256(candidate);
    if (hash === lastHash && (!changedDisplay || hash !== previous.screenshotSha256)) {
      png = candidate;
      break;
    }
    lastHash = hash;
  }
  assert.ok(png, `${name}: composited capture did not stabilize after display change`);
  writeFileSync(join(output, screenshot), png, { flag: 'wx' });
  evidence.cases.push({ name, allowVerticalScroll, measurement, screenshot,
    captureAttempts: captureAttempts + 1, screenshotSha256: sha256(png) });
  assert.equal(measurement.visibilityState, 'visible', `${name}: document hidden`);
  assert.equal(measurement.documentFocused, true, `${name}: document lost focus`);
  assert.ok(measurement.scroll.width <= measurement.viewport.width + 1, `${name}: horizontal document overflow`);
  if (!allowVerticalScroll) {
    assert.ok(measurement.scroll.height <= measurement.viewport.height + 1, `${name}: vertical document overflow`);
    for (const control of measurement.controls) {
      assert.ok(control.rect.x >= -1 && control.rect.y >= -1 && control.rect.right <= measurement.viewport.width + 1
        && control.rect.bottom <= measurement.viewport.height + 1, `${name}: offscreen control ${control.label}`);
    }
  }
  assert.deepEqual(measurement.bridgeKeys, ['contractVersion']);
  return measurement;
}

async function main() {
  try {
    watchdog = setTimeout(() => {
      evidence.status = 'FAIL';
      evidence.failure = 'M1 probe exceeded 120 seconds';
      app.exit(1);
    }, 120_000);
    // Import before ready so the normal entry installs its own lifecycle.
    const created = new Promise((done) => app.once('browser-window-created', (_event, value) => done(value)));
    await import('../../dist/main/index.js');
    window = await created;
    const loaded = new Promise((done, fail) => {
      window.webContents.once('did-finish-load', done);
      window.webContents.once('did-fail-load', (_event, code, description) => fail(new Error(`${code}: ${description}`)));
    });
    window.webContents.on('console-message', (details) => {
      if (details.level === 'error') evidence.rendererErrors.push(details.message);
    });
    window.webContents.once('render-process-gone', (_event, details) => {
      evidence.rendererErrors.push(`render-process-gone: ${details.reason}`);
    });
    await loaded;
    window.show();
    window.focus();
    window.webContents.focus();
    await settle();
    evidence.displays = screen.getAllDisplays().map(({ bounds, workArea, scaleFactor }) => ({ bounds, workArea, scaleFactor }));
    evidence.initialWindow = { bounds: window.getBounds(), contentBounds: window.getContentBounds() };
    const area = screen.getPrimaryDisplay().workArea;
    const initial = window.getBounds();
    assert.ok(initial.x >= area.x && initial.y >= area.y && initial.x + initial.width <= area.x + area.width
      && initial.y + initial.height <= area.y + area.height, 'Initial outer window exceeds work area');
    evidence.checks.push('initial-work-area');
    window.setContentSize(1280, 640);
    window.webContents.setZoomFactor(1);
    nativeTheme.themeSource = 'light';
    const initialPage = await inspect('projects-light-1280x640');
    assert.deepEqual(initialPage.headings, ['Project 一覧']);
    await evaluate('document.activeElement.blur();');
    await key('Tab');
    assert.equal(await evaluate('return document.activeElement.textContent.trim();'), '本文へ移動');
    await key('Enter');
    assert.equal(await evaluate('return document.activeElement.id;'), 'main-content');
    evidence.checks.push('native-skip-link');
    await click('.app-shell__preview-button');
    await key('Tab');
    assert.equal(await evaluate('return document.activeElement.id;'), 'workflow-tab-import');
    await key('End');
    assert.equal(await evaluate('return document.activeElement.id;'), 'workflow-tab-camera');
    assert.equal(await evaluate('return document.querySelector("[aria-selected=true]").id;'), 'workflow-tab-import');
    await key('Enter');
    assert.equal((await inspect('camera-keyboard-light-1280x640')).activeTab, 'workflow-tab-camera');
    evidence.checks.push('native-tabs-manual-activation');
    await click('#inference-settings-link');
    assert.equal(await evaluate('return document.activeElement.id;'), 'settings-heading');
    await inspect('inference-settings-light');
    await click('.settings-page__header button');
    assert.equal(await evaluate('return document.activeElement.id;'), 'inference-settings-link');
    evidence.checks.push('settings-focus-return');
    for (const tab of ['import', 'annotations', 'training', 'reports', 'camera']) {
      await click(`#workflow-tab-${tab}`);
      assert.equal((await inspect(`${tab}-light-1280x640`)).activeTab, `workflow-tab-${tab}`);
    }
    await click('#app-shell-settings-link');
    await click('#settings-category-information');
    await inspect('information-closed-light');
    await click('details:nth-of-type(1) summary');
    await click('details:nth-of-type(2) summary');
    await inspect('information-open-light');
    for (const name of ['LICENSE', 'NOTICE']) {
      await verifyNoticeEnd(name);
    }
    evidence.checks.push('full-notices-and-keyboard-end');
    nativeTheme.themeSource = 'dark';
    await inspect('information-open-dark');
    window.webContents.setZoomFactor(2);
    await inspect('information-open-dark-200', true);
    for (const category of ['project', 'labels', 'inference', 'device', 'information']) {
      await activateWithKeyboard(`#settings-category-${category}`);
      assert.ok(await evaluate(`return !!document.querySelector('#settings-${category}');`));
      await inspect(`${category}-settings-dark-200`, true);
    }
    for (const [index, name] of ['LICENSE', 'NOTICE'].entries()) {
      await activateWithKeyboard(`details:nth-of-type(${index + 1}) summary`);
      assert.ok(await evaluate(`return document.querySelector('details:nth-of-type(${index + 1})').open;`));
      await verifyNoticeEnd(name);
    }
    await activateWithKeyboard('.settings-page__header button');
    assert.equal(await evaluate('return document.activeElement.id;'), 'app-shell-settings-link');
    await inspect('workflow-dark-200', true);
    await activateWithKeyboard('#app-shell-projects-link');
    assert.deepEqual((await inspect('projects-dark-200', true)).headings, ['Project 一覧']);
    await activateWithKeyboard('.skip-link');
    assert.equal(await evaluate('return document.activeElement.id;'), 'main-content');
    for (const [opener, category] of [['#project-settings-link', 'project'], ['#diagnostics-settings-link', 'device']]) {
      await activateWithKeyboard(opener);
      assert.ok(await evaluate(`return !!document.querySelector('#settings-${category}');`));
      await activateWithKeyboard('.settings-page__header button');
      await focusedControl(opener);
    }
    await activateWithKeyboard('.app-shell__preview-button');
    await focusWithTab('[role=tab][aria-selected=true]');
    await key('Home');
    for (const tab of ['import', 'annotations', 'training', 'reports', 'camera']) {
      await focusedControl(`#workflow-tab-${tab}`);
      await key('Enter');
      assert.equal((await inspect(`${tab}-keyboard-dark-200`, true)).activeTab, `workflow-tab-${tab}`);
      if (tab === 'annotations') {
        await activateWithKeyboard('#annotation-labels-link');
        assert.ok(await evaluate('return !!document.querySelector("#settings-labels");'));
        await activateWithKeyboard('.settings-page__header button');
        await focusedControl('#annotation-labels-link');
        await activateWithKeyboard('#annotation-assist-link');
        assert.deepEqual((await inspect('assist-keyboard-dark-200', true)).headings, ['補助ジョブ']);
        await activateWithKeyboard('#assist-back-link');
        assert.ok(await evaluate('return !!document.querySelector("#annotation-labels-link");'));
        await focusWithTab('[role=tab][aria-selected=true]');
      }
      if (tab === 'camera') {
        await activateWithKeyboard('#inference-settings-link');
        assert.ok(await evaluate('return !!document.querySelector("#settings-inference");'));
        await activateWithKeyboard('.settings-page__header button');
        await focusedControl('#inference-settings-link');
      } else await key('Right');
    }
    await activateWithKeyboard('#app-shell-settings-link');
    assert.equal(await evaluate('return document.activeElement.id;'), 'settings-heading');
    await activateWithKeyboard('.settings-page__header button');
    await focusedControl('#app-shell-settings-link');
    evidence.checks.push('200-percent-native-keyboard-all-m1-controls');
    window.webContents.setZoomFactor(1);
    window.setContentSize(1024, 600);
    await inspect('workflow-dark-1024x600', true);
    window.setContentSize(1440, 900);
    await inspect('workflow-dark-1440x900');
    window.setContentSize(1920, 1080);
    await inspect('workflow-dark-1920x1080');
    assert.deepEqual(hashes(sourceFiles), evidence.sourceHashes, 'Source changed during inspection');
    assert.deepEqual(hashes(bundleFiles), evidence.bundleHashes, 'Bundle changed during inspection');
    for (const item of evidence.cases) {
      assert.equal(sha256(readFileSync(join(output, item.screenshot))), item.screenshotSha256, `${item.name}: screenshot changed`);
    }
    assert.deepEqual(evidence.rendererErrors, []);
    evidence.status = 'TECHNICAL_PASS_USER_NOT_RUN';
    app.quit();
  } catch (error) {
    evidence.status = 'FAIL';
    evidence.failure = error instanceof Error ? error.message : String(error);
    console.error(evidence.failure);
    app.exit(1);
  }
}

void main();