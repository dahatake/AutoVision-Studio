import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { cpus, release, totalmem } from 'node:os';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';

import { app, BrowserWindow, screen } from 'electron';

app.commandLine.appendSwitch('disable-background-timer-throttling');

const resultUrl = new URL('./benchmark-result.json', import.meta.url);
const errorUrl = new URL('./dist/benchmark-error.json', import.meta.url);
const repositoryUrl = new URL('../../', import.meta.url);
const repositoryPath = fileURLToPath(repositoryUrl);
const operations = ['move', 'resize', 'create', 'select', 'zoom', 'pan'];
const sourceFiles = [
  'package.json',
  'package-lock.json',
  'spikes/annotation/CanvasSpike.tsx',
  'spikes/annotation/CanvasSpike.test.tsx',
  'build/spi10/benchmark-entry.ts',
  'build/spi10/index.html',
  'build/spi10/main.mjs',
  'build/spi10/vite.config.ts',
  'build/spi10/vitest.config.ts',
];
const bundleSourceFiles = [
  'package.json',
  'package-lock.json',
  'spikes/annotation/CanvasSpike.tsx',
  'build/spi10/benchmark-entry.ts',
  'build/spi10/index.html',
  'build/spi10/vite.config.ts',
];
const warmupCount = 10;
const sampleCount = 100;
const thresholdMs = 100;
const captureRect = { x: 0, y: 0, width: 960, height: 540 };
const markers = [];
const rendererDiagnostics = [];
let partialResult = null;

const mark = (name) => {
  const marker = { name, at: new Date().toISOString() };
  markers.push(marker);
  console.log(`spi10:${name}`);
};

const timeout = async (promise, label, milliseconds) => {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded ${milliseconds} ms`)), milliseconds);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
};

function summarize(samples) {
  if (samples.length === 0 || samples.some((sample) => !Number.isFinite(sample) || sample < 0)) {
    throw new Error('benchmark samples must be non-empty, finite, and non-negative');
  }
  const sorted = [...samples].sort((left, right) => left - right);
  return {
    meanMs: sorted.reduce((sum, sample) => sum + sample, 0) / sorted.length,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    maxMs: sorted.at(-1),
  };
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex').toUpperCase();
}

async function hashSources() {
  const hashes = {};
  for (const relativePath of sourceFiles) {
    hashes[relativePath] = sha256(await readFile(new URL(relativePath, repositoryUrl)));
  }
  return hashes;
}

async function hashBundle() {
  const assetsUrl = new URL('./dist/assets/', import.meta.url);
  const entries = (await readdir(assetsUrl)).filter((entry) => entry.endsWith('.js'));
  if (entries.length !== 1) throw new Error(`expected one JavaScript bundle, found ${entries.length}`);
  return {
    file: `build/spi10/dist/assets/${entries[0]}`,
    sha256: sha256(await readFile(new URL(entries[0], assetsUrl))),
  };
}

function git(...args) {
  return execFileSync('git', args, { cwd: repositoryPath, encoding: 'utf8' }).trim();
}

async function rendererCall(window, method, args = [], milliseconds = 10_000) {
  const serializedArguments = args.map((argument) => JSON.stringify(argument)).join(',');
  return timeout(
    window.webContents.executeJavaScript(
      `window.spi10Benchmark.${method}(${serializedArguments})`,
      true,
    ),
    `renderer ${method}`,
    milliseconds,
  );
}

async function captureStage(window, label) {
  const image = await timeout(window.webContents.capturePage(captureRect), label, 10_000);
  if (image.isEmpty()) throw new Error(`${label} returned an empty image`);
  const bitmap = image.toBitmap();
  return {
    sha256: sha256(bitmap),
    byteLength: bitmap.byteLength,
    size: image.getSize(),
  };
}

async function captureChangedStage(window, baseline, label) {
  const maximumAttempts = 6;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    const capture = await captureStage(window, `${label} attempt ${attempt}`);
    if (
      baseline.size.width !== capture.size.width ||
      baseline.size.height !== capture.size.height ||
      baseline.byteLength !== capture.byteLength
    ) {
      throw new Error(`${label} capture dimensions changed unexpectedly`);
    }
    if (baseline.sha256 !== capture.sha256) {
      return { capture, attemptCount: attempt };
    }
    await settleInput(window);
  }
  throw new Error(`${label} did not change captured pixels after ${maximumAttempts} attempts`);
}

function boxCenter(index) {
  return {
    x: 50 + (index % 10) * 90,
    y: 30 + Math.floor(index / 10) * 50,
  };
}

function boxBottomRight(index) {
  return {
    x: 80 + (index % 10) * 90,
    y: 45 + Math.floor(index / 10) * 50,
  };
}

function createDragPoints(index) {
  const start = {
    x: 5 + (index % 10) * 90,
    y: 50 + Math.floor(index / 10) * 50,
  };
  return { start, end: { x: start.x + 12, y: start.y + 10 } };
}

async function settleInput(window) {
  await rendererCall(window, 'settle');
}

async function sendClick(window, point, verifyPresentation, label) {
  const { webContents } = window;
  webContents.sendInputEvent({ type: 'mouseMove', ...point });
  webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'left', clickCount: 1 });
  await settleInput(window);
  const responsiveBaselineCapture = verifyPresentation
    ? await captureStage(window, `${label} before responsive input`)
    : null;
  const responsiveInputAt = performance.now();
  webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'left', clickCount: 1 });
  return {
    responsiveBaselineCapture,
    responsiveInputAt,
    responsiveInputEvent: 'mouseUp',
    captureBeforeCompletion: false,
    complete: async () => undefined,
  };
}

async function sendDrag(
  window,
  start,
  end,
  button,
  verifyPresentation,
  label,
  measureCompletion = false,
) {
  const { webContents } = window;
  const middle = {
    x: Math.round((start.x + end.x) / 2),
    y: Math.round((start.y + end.y) / 2),
  };
  webContents.sendInputEvent({ type: 'mouseMove', ...start });
  webContents.sendInputEvent({ type: 'mouseDown', ...start, button, clickCount: 1 });
  await settleInput(window);
  webContents.sendInputEvent({
    type: 'mouseMove',
    ...middle,
    button,
    movementX: middle.x - start.x,
    movementY: middle.y - start.y,
  });
  await settleInput(window);
  if (measureCompletion) {
    webContents.sendInputEvent({
      type: 'mouseMove',
      ...end,
      button,
      movementX: end.x - middle.x,
      movementY: end.y - middle.y,
    });
    await settleInput(window);
  }
  const responsiveBaselineCapture = verifyPresentation
    ? await captureStage(window, `${label} before responsive input`)
    : null;
  const responsiveInputAt = performance.now();
  if (!measureCompletion) {
    webContents.sendInputEvent({
      type: 'mouseMove',
      ...end,
      button,
      movementX: end.x - middle.x,
      movementY: end.y - middle.y,
    });
  }
  return {
    responsiveBaselineCapture,
    responsiveInputAt,
    responsiveInputEvent: measureCompletion ? 'mouseUp' : 'final-coordinate-mouseMove',
    captureBeforeCompletion: !measureCompletion,
    complete: async () => {
      webContents.sendInputEvent({ type: 'mouseUp', ...end, button, clickCount: 1 });
    },
  };
}

async function injectOperation(window, operation, index, verifyPresentation) {
  const { webContents } = window;
  const label = `${operation} sample ${index}`;
  switch (operation) {
    case 'create': {
      const points = createDragPoints(index);
      return sendDrag(
        window,
        points.start,
        points.end,
        'left',
        verifyPresentation,
        label,
        true,
      );
    }
    case 'select':
      return sendClick(window, boxCenter(index), verifyPresentation, label);
    case 'move': {
      const start = boxCenter(index);
      return sendDrag(
        window,
        start,
        { x: start.x + 12, y: start.y + 8 },
        'left',
        verifyPresentation,
        label,
      );
    }
    case 'resize': {
      const start = boxBottomRight(index);
      return sendDrag(
        window,
        start,
        { x: start.x + 12, y: start.y + 8 },
        'left',
        verifyPresentation,
        label,
      );
    }
    case 'zoom': {
      const point = boxCenter(index);
      const responsiveBaselineCapture = verifyPresentation
        ? await captureStage(window, `${label} before responsive input`)
        : null;
      const responsiveInputAt = performance.now();
      webContents.sendInputEvent({
        type: 'mouseWheel',
        ...point,
        deltaX: 0,
        deltaY: -120,
        wheelTicksX: 0,
        wheelTicksY: -1,
        canScroll: true,
      });
      return {
        responsiveBaselineCapture,
        responsiveInputAt,
        responsiveInputEvent: 'mouseWheel',
        captureBeforeCompletion: false,
        complete: async () => undefined,
      };
    }
    case 'pan':
      return sendDrag(
        window,
        { x: 920, y: 520 },
        { x: 880, y: 500 },
        'middle',
        verifyPresentation,
        label,
      );
    default:
      throw new Error(`unknown benchmark operation: ${operation}`);
  }
}

function findBox(state, id) {
  return state.boxes.find((box) => box.id === id);
}

function assertCanvasState(state, label) {
  for (const box of state.boxes) {
    const values = [box.x, box.y, box.width, box.height];
    if (values.some((value) => !Number.isFinite(value))) {
      throw new Error(`${label} produced non-finite rectangle coordinates`);
    }
    if (
      box.x < 0 ||
      box.y < 0 ||
      box.width < 4 ||
      box.height < 4 ||
      box.x + box.width > 3840 ||
      box.y + box.height > 2160
    ) {
      throw new Error(`${label} produced an out-of-image rectangle`);
    }
  }
}

function assertBundleSourceHashes(rendererHashes, sourceHashes) {
  const entries = Object.entries(rendererHashes);
  const actualFiles = entries.map(([relativePath]) => relativePath).sort();
  const expectedFiles = [...bundleSourceFiles].sort();
  if (JSON.stringify(actualFiles) !== JSON.stringify(expectedFiles)) {
    throw new Error(
      `renderer bundle source hash keys differ: expected=${expectedFiles.join(',')}, ` +
      `actual=${actualFiles.join(',')}`,
    );
  }
  for (const [relativePath, embeddedHash] of entries) {
    if (sourceHashes[relativePath] !== embeddedHash) {
      throw new Error(`renderer bundle is stale for ${relativePath}`);
    }
  }
}

function assertOperationResult(operation, index, before, after) {
  assertCanvasState(after, `${operation} sample ${index}`);
  const id = `box-${index}`;
  switch (operation) {
    case 'create':
      if (before.boxes.length !== 100 || after.boxes.length !== 101 || findBox(after, 'box-100') === undefined) {
        throw new Error(
          `create sample ${index} did not add exactly one rectangle: ` +
          `before=${before.boxes.length}, after=${after.boxes.length}, ` +
          `lastId=${after.boxes.at(-1)?.id ?? 'none'}, selectedId=${after.selectedId ?? 'none'}`,
        );
      }
      return;
    case 'select':
      if (after.selectedId !== id) throw new Error(`select sample ${index} selected ${after.selectedId}`);
      return;
    case 'move': {
      const beforeBox = findBox(before, id);
      const afterBox = findBox(after, id);
      if (beforeBox === undefined || afterBox === undefined || (beforeBox.x === afterBox.x && beforeBox.y === afterBox.y)) {
        throw new Error(
          `move sample ${index} did not move ${id}: ` +
          `before=${JSON.stringify(beforeBox)}, after=${JSON.stringify(afterBox)}`,
        );
      }
      return;
    }
    case 'resize': {
      const beforeBox = findBox(before, id);
      const afterBox = findBox(after, id);
      if (
        beforeBox === undefined ||
        afterBox === undefined ||
        (beforeBox.width === afterBox.width && beforeBox.height === afterBox.height)
      ) {
        throw new Error(
          `resize sample ${index} did not resize ${id}: ` +
          `before=${JSON.stringify(beforeBox)}, after=${JSON.stringify(afterBox)}`,
        );
      }
      return;
    }
    case 'zoom':
      if (before.viewport.scale === after.viewport.scale) {
        throw new Error(`zoom sample ${index} did not change viewport scale`);
      }
      return;
    case 'pan':
      if (before.viewport.x === after.viewport.x && before.viewport.y === after.viewport.y) {
        throw new Error(`pan sample ${index} did not change viewport position`);
      }
      return;
    default:
      throw new Error(`unknown operation result: ${operation}`);
  }
}

async function prepareSample(window, operation, index) {
  const resetState = await rendererCall(window, 'reset');
  if (resetState.boxes.length !== 100) {
    throw new Error(`${operation} sample ${index} reset to ${resetState.boxes.length} rectangles`);
  }
  if (operation === 'resize') {
    await sendClick(window, boxCenter(index), false, `${operation} sample ${index} setup`);
    const selectedState = await rendererCall(window, 'settle');
    if (selectedState.selectedId !== `box-${index}`) {
      throw new Error(`resize sample ${index} could not select box-${index}`);
    }
    return selectedState;
  }
  return resetState;
}

async function verifyInvalidCreateRecovery(window) {
  await rendererCall(window, 'reset');
  const token = await rendererCall(window, 'prepare', ['create']);
  const point = { x: 920, y: 520 };
  window.webContents.sendInputEvent({ type: 'mouseMove', ...point });
  window.webContents.sendInputEvent({ type: 'mouseDown', ...point, button: 'right', clickCount: 1 });
  await settleInput(window);
  window.webContents.sendInputEvent({ type: 'mouseUp', ...point, button: 'right', clickCount: 1 });

  let rejectionMessage = null;
  try {
    await rendererCall(window, 'wait', [token]);
  } catch (error) {
    rejectionMessage = error instanceof Error ? error.message : String(error);
  }
  if (rejectionMessage === null || !rejectionMessage.includes('primary mouse button')) {
    throw new Error(`invalid create was not rejected as expected: ${rejectionMessage ?? 'resolved'}`);
  }
  const recovered = await rendererCall(window, 'reset');
  if (recovered.boxes.length !== 100) {
    throw new Error(`invalid create recovery reset to ${recovered.boxes.length} rectangles`);
  }
  return { rejected: true, recovered: true, rejectionMessage };
}

async function verifyMouseUpEndpointRecovery(window) {
  await rendererCall(window, 'reset');
  const createToken = await rendererCall(window, 'prepare', ['create']);
  const createStart = { x: 920, y: 500 };
  const createEnd = { x: 940, y: 520 };
  window.webContents.sendInputEvent({ type: 'mouseMove', ...createStart });
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    ...createStart,
    button: 'left',
    clickCount: 1,
  });
  await settleInput(window);
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    ...createEnd,
    button: 'left',
    clickCount: 1,
  });
  const createdState = await rendererCall(window, 'wait', [createToken]);
  const createdBox = findBox(createdState, 'box-100');
  if (
    createdState.boxes.length !== 101 ||
    createdBox === undefined ||
    createdBox.x !== 3680 ||
    createdBox.y !== 2000 ||
    createdBox.width !== 80 ||
    createdBox.height !== 80
  ) {
    throw new Error(`mouseUp endpoint did not complete create: ${JSON.stringify(createdBox)}`);
  }

  const beforePan = await rendererCall(window, 'reset');
  const panToken = await rendererCall(window, 'prepare', ['pan']);
  const panStart = { x: 920, y: 500 };
  const panEnd = { x: 880, y: 480 };
  window.webContents.sendInputEvent({ type: 'mouseMove', ...panStart });
  window.webContents.sendInputEvent({
    type: 'mouseDown',
    ...panStart,
    button: 'middle',
    clickCount: 1,
  });
  await settleInput(window);
  window.webContents.sendInputEvent({
    type: 'mouseUp',
    ...panEnd,
    button: 'middle',
    clickCount: 1,
  });
  const afterPan = await rendererCall(window, 'wait', [panToken]);
  if (
    afterPan.viewport.x - beforePan.viewport.x !== -40 ||
    afterPan.viewport.y - beforePan.viewport.y !== -20
  ) {
    throw new Error(
      `mouseUp endpoint did not complete pan: before=${JSON.stringify(beforePan.viewport)}, ` +
      `after=${JSON.stringify(afterPan.viewport)}`,
    );
  }
  return {
    createUsedMouseUpEndpoint: true,
    panUsedMouseUpEndpoint: true,
  };
}

async function verifyPanGeometryExclusion(window, start, label, selectFirst) {
  const before = await rendererCall(window, 'reset');
  if (selectFirst) {
    await sendClick(window, boxCenter(0), false, `${label} setup`);
    await settleInput(window);
  }
  const token = await rendererCall(window, 'prepare', ['pan']);
  const interaction = await sendDrag(
    window,
    start,
    { x: start.x + 24, y: start.y + 16 },
    'middle',
    false,
    label,
  );
  await settleInput(window);
  await interaction.complete();
  const after = await rendererCall(window, 'wait', [token]);
  const beforeBox = findBox(before, 'box-0');
  const afterBox = findBox(after, 'box-0');
  if (JSON.stringify(beforeBox) !== JSON.stringify(afterBox)) {
    throw new Error(`${label} changed rectangle geometry`);
  }
  if (before.viewport.x === after.viewport.x && before.viewport.y === after.viewport.y) {
    throw new Error(`${label} did not pan the viewport`);
  }
  return { boxGeometryUnchanged: true, viewportChanged: true };
}

async function runSample(window, operation, index, verifyPresentation) {
  const before = await prepareSample(window, operation, index);
  if (verifyPresentation && (!window.isFocused() || !window.webContents.isFocused())) {
    throw new Error(
      `${operation} sample ${index} lost focus after capture: ` +
      `window=${window.isFocused()}, webContents=${window.webContents.isFocused()}`,
    );
  }
  const token = await rendererCall(window, 'prepare', [operation]);
  const gestureStartedAt = performance.now();
  const interaction = await injectOperation(window, operation, index, verifyPresentation);
  const responsiveBaselineCapture = interaction.responsiveBaselineCapture;
  if (verifyPresentation && responsiveBaselineCapture === null) {
    throw new Error(`${operation} sample ${index} has no responsive-input baseline capture`);
  }
  let afterCapture;
  let captureAttemptCount = 0;
  let paintBoundaryAt;
  let capturedPresentationAt;
  let after;
  if (interaction.captureBeforeCompletion) {
    await settleInput(window);
    paintBoundaryAt = performance.now();
    if (verifyPresentation) {
      const changed = await captureChangedStage(
        window,
        responsiveBaselineCapture,
        `${operation} sample ${index} after responsive input`,
      );
      afterCapture = changed.capture;
      captureAttemptCount = changed.attemptCount;
    } else {
      afterCapture = null;
    }
    capturedPresentationAt = performance.now();
    await interaction.complete();
    after = await rendererCall(window, 'wait', [token]);
  } else {
    await interaction.complete();
    after = await rendererCall(window, 'wait', [token]);
    paintBoundaryAt = performance.now();
    if (verifyPresentation) {
      const changed = await captureChangedStage(
        window,
        responsiveBaselineCapture,
        `${operation} sample ${index} after responsive input`,
      );
      afterCapture = changed.capture;
      captureAttemptCount = changed.attemptCount;
    } else {
      afterCapture = null;
    }
    capturedPresentationAt = performance.now();
  }

  assertOperationResult(operation, index, before, after);
  if (verifyPresentation) {
    if (responsiveBaselineCapture.sha256 === afterCapture.sha256) {
      throw new Error(`${operation} sample ${index} capture retry returned unchanged pixels`);
    }
  }

  return {
    responsiveInputEvent: interaction.responsiveInputEvent,
    responsiveInputToPaintBoundaryMs: paintBoundaryAt - interaction.responsiveInputAt,
    responsiveInputToCapturedPresentationMs:
      capturedPresentationAt - interaction.responsiveInputAt,
    gestureToPaintBoundaryMs: paintBoundaryAt - gestureStartedAt,
    gestureToCapturedPresentationMs: capturedPresentationAt - gestureStartedAt,
    captureAttemptCount,
    capture: verifyPresentation
      ? {
          size: afterCapture.size,
          byteLength: afterCapture.byteLength,
          beforeSha256: responsiveBaselineCapture.sha256,
          afterSha256: afterCapture.sha256,
        }
      : null,
  };
}

async function measureOperation(window, operation) {
  mark(`${operation}-warmup-start`);
  for (let index = 0; index < warmupCount; index += 1) {
    await runSample(window, operation, index, false);
  }
  mark(`${operation}-warmup-end`);

  const responsiveInputToPaintBoundaryMs = [];
  const responsiveInputToCapturedPresentationMs = [];
  const gestureToPaintBoundaryMs = [];
  const gestureToCapturedPresentationMs = [];
  const captureAttemptCounts = [];
  let responsiveInputEvent = null;
  let firstCapture = null;
  mark(`${operation}-measure-start`);
  for (let index = 0; index < sampleCount; index += 1) {
    const sample = await runSample(window, operation, index, true);
    if (responsiveInputEvent !== null && responsiveInputEvent !== sample.responsiveInputEvent) {
      throw new Error(`${operation} changed responsive input event during measurement`);
    }
    responsiveInputEvent = sample.responsiveInputEvent;
    responsiveInputToPaintBoundaryMs.push(sample.responsiveInputToPaintBoundaryMs);
    responsiveInputToCapturedPresentationMs.push(sample.responsiveInputToCapturedPresentationMs);
    gestureToPaintBoundaryMs.push(sample.gestureToPaintBoundaryMs);
    gestureToCapturedPresentationMs.push(sample.gestureToCapturedPresentationMs);
    captureAttemptCounts.push(sample.captureAttemptCount);
    firstCapture ??= sample.capture;
  }
  mark(`${operation}-measure-end`);
  return {
    distinctRectangleTargets: operation === 'pan' || operation === 'create' ? null : 100,
    pixelChangeCount: sampleCount,
    responsiveInputEvent,
    firstCapture,
    responsiveInputToPaintBoundary: summarize(responsiveInputToPaintBoundaryMs),
    responsiveInputToCapturedPresentation: summarize(responsiveInputToCapturedPresentationMs),
    gestureToPaintBoundary: summarize(gestureToPaintBoundaryMs),
    gestureToCapturedPresentation: summarize(gestureToCapturedPresentationMs),
    maximumCaptureAttempts: Math.max(...captureAttemptCounts),
    rawResponsiveInputToPaintBoundaryMs: responsiveInputToPaintBoundaryMs,
    rawResponsiveInputToCapturedPresentationMs: responsiveInputToCapturedPresentationMs,
    rawGestureToPaintBoundaryMs: gestureToPaintBoundaryMs,
    rawGestureToCapturedPresentationMs: gestureToCapturedPresentationMs,
    rawCaptureAttemptCounts: captureAttemptCounts,
  };
}

async function runInputBenchmark(window) {
  window.show();
  window.focus();
  window.webContents.focus();
  const renderer = await rendererCall(window, 'ready');
  const focus = {
    browserWindowFocused: window.isFocused(),
    webContentsFocused: window.webContents.isFocused(),
    rendererDocumentFocused: renderer.hasFocus,
    visibilityState: renderer.visibilityState,
  };
  if (!focus.browserWindowFocused || !focus.webContentsFocused || !focus.rendererDocumentFocused) {
    throw new Error(`benchmark window is not focused: ${JSON.stringify(focus)}`);
  }
  if (
    renderer.state.boxes.length !== 100 ||
    renderer.canvasElementCount !== 2 ||
    renderer.containerBounds.width !== captureRect.width ||
    renderer.containerBounds.height !== captureRect.height
  ) {
    throw new Error(`renderer readiness check failed: ${JSON.stringify(renderer)}`);
  }

  const animationFrameIntervalsMs = await rendererCall(
    window,
    'measureAnimationFrames',
    [60],
    30_000,
  );
  const adversarialChecks = {
    invalidCreateRecovery: await verifyInvalidCreateRecovery(window),
    mouseUpEndpointRecovery: await verifyMouseUpEndpointRecovery(window),
    panFromRectangle: await verifyPanGeometryExclusion(
      window,
      boxCenter(0),
      'pan from rectangle',
      false,
    ),
    panFromTransformerHandle: await verifyPanGeometryExclusion(
      window,
      boxBottomRight(0),
      'pan from transformer handle',
      true,
    ),
  };
  const operationResults = {};
  for (const operation of operations) {
    operationResults[operation] = await measureOperation(window, operation);
  }
  return {
    renderer,
    focus,
    adversarialChecks,
    animationFrameIntervalsMs,
    animationFrameCadence: summarize(animationFrameIntervalsMs),
    operations: operationResults,
  };
}

async function runBenchmarkHarness() {
  let window;
  let exitCode = 0;
  const runId = randomUUID();
  try {
    await rm(resultUrl, { force: true });
    await rm(errorUrl, { force: true });
    const runtimeProfileUrl = new URL(`./dist/runtime-profile-${runId}/`, import.meta.url);
    await mkdir(runtimeProfileUrl, { recursive: true });
    const runtimeProfilePath = fileURLToPath(runtimeProfileUrl);
    app.setPath('userData', runtimeProfilePath);
    app.setPath('sessionData', runtimeProfilePath);
    const sourceHashesBefore = await hashSources();
    const bundleBefore = await hashBundle();
    const gitHead = git('rev-parse', 'HEAD');
    const gitStatus = git('status', '--short');

    mark('app-ready-start');
    await timeout(app.whenReady(), 'app ready', 30_000);
    mark('app-ready-end');
    window = new BrowserWindow({
      width: 1100,
      height: 700,
      show: true,
      webPreferences: {
        backgroundThrottling: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    window.webContents.on('console-message', (details) => {
      rendererDiagnostics.push({
        type: 'console',
        level: details.level,
        message: details.message,
        lineNumber: details.lineNumber,
        sourceId: details.sourceId,
      });
    });
    window.webContents.on('render-process-gone', (_event, details) => {
      rendererDiagnostics.push({ type: 'render-process-gone', ...details });
    });
    mark('loadFile-start');
    await timeout(
      window.loadFile(fileURLToPath(new URL('./dist/index.html', import.meta.url))),
      'loadFile',
      30_000,
    );
    mark('loadFile-end');
    mark('GPU-info-start');
    const gpu = await timeout(app.getGPUInfo('basic'), 'GPU info', 30_000);
    mark('GPU-info-end');
    mark('input-benchmark-start');
    const benchmark = await timeout(runInputBenchmark(window), 'input benchmark', 600_000);
    mark('input-benchmark-end');
    partialResult = benchmark;

    const failedOperations = operations.filter(
      (operation) =>
        benchmark.operations[operation].responsiveInputToCapturedPresentation.p95Ms > thresholdMs,
    );
    if (failedOperations.length !== 0) {
      throw new Error(`p95 exceeded ${thresholdMs} ms: ${failedOperations.join(', ')}`);
    }
    const fatalRendererDiagnostics = rendererDiagnostics.filter(
      (entry) => entry.type === 'render-process-gone' || entry.level === 'error',
    );
    if (fatalRendererDiagnostics.length !== 0) {
      throw new Error(`renderer emitted fatal diagnostics: ${JSON.stringify(fatalRendererDiagnostics)}`);
    }

    const sourceHashesAfter = await hashSources();
    const bundleAfter = await hashBundle();
    if (JSON.stringify(sourceHashesBefore) !== JSON.stringify(sourceHashesAfter)) {
      throw new Error('benchmark source changed during the run');
    }
    if (JSON.stringify(bundleBefore) !== JSON.stringify(bundleAfter)) {
      throw new Error('benchmark bundle changed during the run');
    }
    assertBundleSourceHashes(benchmark.renderer.buildSourceHashes, sourceHashesAfter);

    const output = JSON.stringify({
      status: 'ok',
      verdict: 'PASS',
      runId,
      measuredAt: new Date().toISOString(),
      threshold: {
        requirement: 'NFR-ANN-002',
        metric: 'responsiveInputToCapturedPresentation.p95Ms',
        maximumMs: thresholdMs,
      },
      command: 'node node_modules\\electron\\cli.js build\\spi10\\main.mjs',
      isolatedRuntimeProfile: true,
      gitHead,
      gitStatus,
      sourceHashes: sourceHashesAfter,
      bundle: bundleAfter,
      markers,
      rendererDiagnostics,
      platform: process.platform,
      architecture: process.arch,
      osRelease: release(),
      cpuModel: cpus()[0]?.model ?? null,
      logicalCpuCount: cpus().length,
      totalMemoryBytes: totalmem(),
      displays: screen.getAllDisplays().map((display) => ({
        id: display.id,
        bounds: display.bounds,
        workAreaSize: display.workAreaSize,
        scaleFactor: display.scaleFactor,
        rotation: display.rotation,
        displayFrequency: display.displayFrequency,
      })),
      window: {
        bounds: window.getBounds(),
        contentBounds: window.getContentBounds(),
        visible: window.isVisible(),
        focused: window.isFocused(),
      },
      versions: process.versions,
      gpuFeatureStatus: app.getGPUFeatureStatus(),
      gpu,
      benchmark: {
        logicalImage: { width: 3840, height: 2160 },
        imageSource: 'in-memory-rgba-bitmap',
        viewport: captureRect,
        initialBoxCount: 100,
        warmupCount,
        samplesPerOperation: sampleCount,
        inputSource: 'webContents.sendInputEvent',
        paintBoundary: 'second-animation-frame-after-responsive-input-or-react-konva-commit',
        presentationBoundary: 'webContents.capturePage-complete-with-changed-bitmap-sha256',
        requirementMetric: 'responsiveInputToCapturedPresentation',
        ...benchmark,
      },
    }, null, 2);
    await writeFile(resultUrl, output, 'utf8');
    mark('result-written');
  } catch (error) {
    exitCode = 1;
    const failure = JSON.stringify({
      status: 'error',
      verdict: 'FAIL',
      runId,
      measuredAt: new Date().toISOString(),
      markers,
      rendererDiagnostics,
      partialResult,
      name: error instanceof Error ? error.name : 'UnknownError',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : null,
    }, null, 2);
    try {
      await writeFile(errorUrl, failure, 'utf8');
    } catch (writeError) {
      console.error('spi10:error-write-failed', writeError);
    }
    console.error('spi10:failed', error);
  } finally {
    mark(`exit-${exitCode}`);
    process.exitCode = exitCode;
    app.quit();
  }
}

void runBenchmarkHarness();
