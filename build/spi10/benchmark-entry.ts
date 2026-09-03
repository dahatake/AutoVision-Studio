import { createElement, createRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import {
  CanvasSpike,
  type CanvasOperationName,
  type CanvasSpikeHandle,
  type CanvasState,
  type CanvasVisualState,
} from '../../spikes/annotation/CanvasSpike';

declare const __SPI10_BUILD_SOURCE_HASHES__: Readonly<Record<string, string>>;

const OPERATION_TIMEOUT_MS = 5_000;

interface MountedCanvas {
  readonly root: Root;
  readonly handle: CanvasSpikeHandle;
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

async function settleFrames(count = 2): Promise<void> {
  for (let index = 0; index < count; index += 1) await nextFrame();
}

async function mountCanvas(container: HTMLDivElement): Promise<MountedCanvas> {
  const ref = createRef<CanvasSpikeHandle>();
  const root = createRoot(container);
  let renderError: Error | null = null;
  const onError = (event: ErrorEvent): void => {
    renderError = event.error instanceof Error ? event.error : new Error(event.message);
  };
  window.addEventListener('error', onError);
  root.render(createElement(CanvasSpike, { ref }));
  for (let attempt = 0; attempt < 120 && ref.current === null; attempt += 1) {
    await nextFrame();
  }
  window.removeEventListener('error', onError);
  if (ref.current === null) {
    root.unmount();
    throw renderError ?? new Error('CanvasSpike did not mount within 120 animation frames');
  }
  await nextFrame();
  return { root, handle: ref.current };
}

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(
      () => reject(new Error(`${label} exceeded ${OPERATION_TIMEOUT_MS} ms`)),
      OPERATION_TIMEOUT_MS,
    );
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

interface RendererBenchmarkInfo {
  readonly state: CanvasState;
  readonly devicePixelRatio: number;
  readonly visibilityState: DocumentVisibilityState;
  readonly hasFocus: boolean;
  readonly canvasElementCount: number;
  readonly containerBounds: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly buildSourceHashes: Readonly<Record<string, string>>;
}

interface RendererBenchmarkApi {
  ready(): Promise<RendererBenchmarkInfo>;
  reset(): Promise<CanvasState>;
  prepare(operation: CanvasOperationName): Promise<number>;
  wait(token: number): Promise<CanvasState>;
  settle(): Promise<CanvasState>;
  visual(): Promise<CanvasVisualState>;
  measureAnimationFrames(count: number): Promise<readonly number[]>;
}

declare global {
  interface Window {
    spi10Benchmark: RendererBenchmarkApi;
  }
}

const container = document.querySelector<HTMLDivElement>('#benchmark');
if (container === null) throw new Error('benchmark container not found');
const mountedCanvas = mountCanvas(container);

window.spi10Benchmark = {
  async ready() {
    const mounted = await mountedCanvas;
    await settleFrames();
    const bounds = container.getBoundingClientRect();
    return {
      state: mounted.handle.getState(),
      devicePixelRatio: window.devicePixelRatio,
      visibilityState: document.visibilityState,
      hasFocus: document.hasFocus(),
      canvasElementCount: container.querySelectorAll('canvas').length,
      containerBounds: {
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
      },
      buildSourceHashes: __SPI10_BUILD_SOURCE_HASHES__,
    };
  },
  async reset() {
    const mounted = await mountedCanvas;
    await withTimeout(mounted.handle.reset(), 'canvas reset');
    return mounted.handle.getState();
  },
  async prepare(operation) {
    const mounted = await mountedCanvas;
    return mounted.handle.prepareInteraction(operation);
  },
  async wait(token) {
    const mounted = await mountedCanvas;
    await withTimeout(mounted.handle.waitForInteraction(token), `canvas interaction ${token}`);
    return mounted.handle.getState();
  },
  async settle() {
    const mounted = await mountedCanvas;
    await settleFrames();
    return mounted.handle.getState();
  },
  async visual() {
    const mounted = await mountedCanvas;
    return mounted.handle.getVisualState();
  },
  async measureAnimationFrames(count) {
    if (!Number.isInteger(count) || count < 2 || count > 120) {
      throw new Error('animation frame sample count must be an integer from 2 through 120');
    }
    const intervals: number[] = [];
    let previous = performance.now();
    for (let index = 0; index < count; index += 1) {
      await nextFrame();
      const current = performance.now();
      intervals.push(current - previous);
      previous = current;
    }
    return intervals;
  },
};
