import Konva from 'konva';
import React, {
  forwardRef,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import { Image as KonvaImage, Layer, Rect, Stage, Transformer } from 'react-konva';

export const IMAGE_WIDTH = 3840;
export const IMAGE_HEIGHT = 2160;
const MIN_BOX_SIZE = 4;
const VIEWPORT_WIDTH = 960;
const VIEWPORT_HEIGHT = 540;

export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
}

export interface CanvasBox extends CanvasPoint {
  readonly id: string;
  readonly width: number;
  readonly height: number;
}

export interface CanvasViewport extends CanvasPoint {
  readonly scale: number;
}

export interface CanvasTransformBox extends CanvasPoint {
  readonly width: number;
  readonly height: number;
  readonly rotation: number;
}

export interface CanvasState {
  readonly boxes: readonly CanvasBox[];
  readonly selectedId: string | null;
  readonly viewport: CanvasViewport;
}

export type CanvasAction =
  | { readonly type: 'reset' }
  | { readonly type: 'select'; readonly id: string | null }
  | { readonly type: 'create'; readonly id: string; readonly start: CanvasPoint; readonly end: CanvasPoint }
  | { readonly type: 'move'; readonly id: string; readonly x: number; readonly y: number }
  | { readonly type: 'resize'; readonly id: string; readonly box: Omit<CanvasBox, 'id'> }
  | { readonly type: 'zoom'; readonly pointer: CanvasPoint; readonly factor: number }
  | { readonly type: 'pan'; readonly delta: CanvasPoint };

export type CanvasOperationName = 'create' | 'select' | 'move' | 'resize' | 'zoom' | 'pan';

export interface OperationMetric {
  readonly meanMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

export interface CanvasSpikeHandle {
  reset(): Promise<void>;
  prepareInteraction(operation: CanvasOperationName): number;
  waitForInteraction(token: number): Promise<void>;
  getState(): CanvasState;
}

function requireFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new Error(`${label} must be finite`);
  }
}

export function clampBox(box: Omit<CanvasBox, 'id'>): Omit<CanvasBox, 'id'> {
  requireFinite(box.x, 'x');
  requireFinite(box.y, 'y');
  requireFinite(box.width, 'width');
  requireFinite(box.height, 'height');

  if (box.width < MIN_BOX_SIZE || box.height < MIN_BOX_SIZE) {
    throw new Error(`box dimensions must be at least ${MIN_BOX_SIZE} image pixels`);
  }

  const width = Math.min(IMAGE_WIDTH, box.width);
  const height = Math.min(IMAGE_HEIGHT, box.height);
  const x = Math.min(IMAGE_WIDTH - width, Math.max(0, box.x));
  const y = Math.min(IMAGE_HEIGHT - height, Math.max(0, box.y));
  return { x, y, width, height };
}

function boxFromPoints(start: CanvasPoint, end: CanvasPoint): Omit<CanvasBox, 'id'> | null {
  requireFinite(start.x, 'start x');
  requireFinite(start.y, 'start y');
  requireFinite(end.x, 'end x');
  requireFinite(end.y, 'end y');

  const left = Math.max(0, Math.min(start.x, end.x));
  const top = Math.max(0, Math.min(start.y, end.y));
  const right = Math.min(IMAGE_WIDTH, Math.max(start.x, end.x));
  const bottom = Math.min(IMAGE_HEIGHT, Math.max(start.y, end.y));
  const width = right - left;
  const height = bottom - top;
  if (width < MIN_BOX_SIZE || height < MIN_BOX_SIZE) {
    return null;
  }
  return { x: left, y: top, width, height };
}

function requireViewport(viewport: CanvasViewport): void {
  requireFinite(viewport.x, 'viewport x');
  requireFinite(viewport.y, 'viewport y');
  requireFinite(viewport.scale, 'viewport scale');
  if (viewport.scale <= 0) throw new Error('viewport scale must be positive');
}

function viewportPointToImage(point: CanvasPoint, viewport: CanvasViewport): CanvasPoint {
  requireViewport(viewport);
  requireFinite(point.x, 'viewport point x');
  requireFinite(point.y, 'viewport point y');
  return {
    x: (point.x - viewport.x) / viewport.scale,
    y: (point.y - viewport.y) / viewport.scale,
  };
}

function imagePointToViewport(point: CanvasPoint, viewport: CanvasViewport): CanvasPoint {
  requireViewport(viewport);
  requireFinite(point.x, 'image point x');
  requireFinite(point.y, 'image point y');
  return {
    x: viewport.x + point.x * viewport.scale,
    y: viewport.y + point.y * viewport.scale,
  };
}

export function clampDragPosition(
  absolutePosition: CanvasPoint,
  box: CanvasBox,
  viewport: CanvasViewport,
): CanvasPoint {
  const imagePosition = viewportPointToImage(absolutePosition, viewport);
  const clamped = clampBox({ ...box, ...imagePosition });
  return imagePointToViewport(clamped, viewport);
}

export function clampTransformBox(
  oldBox: CanvasTransformBox,
  newBox: CanvasTransformBox,
  viewport: CanvasViewport,
): CanvasTransformBox {
  requireViewport(viewport);
  const imageBox = {
    x: (newBox.x - viewport.x) / viewport.scale,
    y: (newBox.y - viewport.y) / viewport.scale,
    width: newBox.width / viewport.scale,
    height: newBox.height / viewport.scale,
  };
  if (
    Object.values(imageBox).some((value) => !Number.isFinite(value)) ||
    imageBox.width < MIN_BOX_SIZE ||
    imageBox.height < MIN_BOX_SIZE
  ) {
    return oldBox;
  }
  const clamped = clampBox(imageBox);
  const position = imagePointToViewport(clamped, viewport);
  return {
    ...newBox,
    x: position.x,
    y: position.y,
    width: clamped.width * viewport.scale,
    height: clamped.height * viewport.scale,
  };
}

export function createInitialBoxes(): readonly CanvasBox[] {
  return Array.from({ length: 100 }, (_, index) => {
    const column = index % 10;
    const row = Math.floor(index / 10);
    return {
      id: `box-${index}`,
      x: 80 + column * 360,
      y: 60 + row * 200,
      width: 240,
      height: 120,
    };
  });
}

export function createInitialCanvasState(): CanvasState {
  return {
    boxes: createInitialBoxes(),
    selectedId: null,
    viewport: { x: 0, y: 0, scale: 0.25 },
  };
}

export function reduceCanvasState(state: CanvasState, action: CanvasAction): CanvasState {
  switch (action.type) {
    case 'reset':
      return createInitialCanvasState();
    case 'select':
      return {
        ...state,
        selectedId:
          action.id === null || state.boxes.some((box) => box.id === action.id)
            ? action.id
            : state.selectedId,
      };
    case 'create': {
      if (state.boxes.some((box) => box.id === action.id)) return state;
      const box = boxFromPoints(action.start, action.end);
      if (box === null) return state;
      return {
        ...state,
        boxes: [...state.boxes, { id: action.id, ...box }],
        selectedId: action.id,
      };
    }
    case 'move':
      return {
        ...state,
        boxes: state.boxes.map((box) =>
          box.id === action.id ? { id: box.id, ...clampBox({ ...box, x: action.x, y: action.y }) } : box,
        ),
      };
    case 'resize':
      if (action.box.width < MIN_BOX_SIZE || action.box.height < MIN_BOX_SIZE) return state;
      return {
        ...state,
        boxes: state.boxes.map((box) =>
          box.id === action.id ? { id: box.id, ...clampBox(action.box) } : box,
        ),
      };
    case 'zoom': {
      requireFinite(action.factor, 'zoom factor');
      if (action.factor <= 0) return state;
      requireFinite(action.pointer.x, 'zoom pointer x');
      requireFinite(action.pointer.y, 'zoom pointer y');
      const oldScale = state.viewport.scale;
      const scale = Math.min(2, Math.max(0.1, oldScale * action.factor));
      const imagePoint = {
        x: (action.pointer.x - state.viewport.x) / oldScale,
        y: (action.pointer.y - state.viewport.y) / oldScale,
      };
      return {
        ...state,
        viewport: {
          scale,
          x: action.pointer.x - imagePoint.x * scale,
          y: action.pointer.y - imagePoint.y * scale,
        },
      };
    }
    case 'pan':
      requireFinite(action.delta.x, 'pan delta x');
      requireFinite(action.delta.y, 'pan delta y');
      return {
        ...state,
        viewport: {
          ...state.viewport,
          x: state.viewport.x + action.delta.x,
          y: state.viewport.y + action.delta.y,
        },
      };
  }
}

function toImagePoint(stage: Konva.Stage): CanvasPoint | null {
  const pointer = stage.getPointerPosition();
  if (pointer === null) return null;
  return {
    x: (pointer.x - stage.x()) / stage.scaleX(),
    y: (pointer.y - stage.y()) / stage.scaleY(),
  };
}

function createBenchmarkImage(): HTMLCanvasElement {
  const image = document.createElement('canvas');
  image.width = IMAGE_WIDTH;
  image.height = IMAGE_HEIGHT;
  const context = image.getContext('2d');
  if (context === null) throw new Error('2D canvas is unavailable');

  const gradient = context.createLinearGradient(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
  gradient.addColorStop(0, '#111827');
  gradient.addColorStop(0.5, '#334155');
  gradient.addColorStop(1, '#0f172a');
  context.fillStyle = gradient;
  context.fillRect(0, 0, IMAGE_WIDTH, IMAGE_HEIGHT);
  context.strokeStyle = '#475569';
  context.lineWidth = 2;
  for (let x = 0; x <= IMAGE_WIDTH; x += 240) {
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, IMAGE_HEIGHT);
    context.stroke();
  }
  for (let y = 0; y <= IMAGE_HEIGHT; y += 180) {
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(IMAGE_WIDTH, y);
    context.stroke();
  }
  return image;
}

interface PendingPaint {
  readonly token: number;
  readonly operation: CanvasOperationName | 'reset';
  readonly promise: Promise<void>;
  readonly resolve: () => void;
  readonly reject: (error: Error) => void;
  started: boolean;
  scheduled: boolean;
}

export const CanvasSpike = forwardRef<CanvasSpikeHandle>(function CanvasSpike(
  _props,
  ref,
): React.JSX.Element {
  const [state, dispatch] = useReducer(reduceCanvasState, undefined, createInitialCanvasState);
  const [draft, setDraft] = useState<{ readonly start: CanvasPoint; readonly end: CanvasPoint } | null>(null);
  const [isPanning, setIsPanning] = useState(false);
  const [benchmarkRevision, advanceBenchmarkRevision] = useReducer((value: number) => value + 1, 0);
  const benchmarkImage = useMemo(createBenchmarkImage, []);
  const nextId = useRef(100);
  const draftRef = useRef<{ readonly start: CanvasPoint; readonly end: CanvasPoint } | null>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const boxRefs = useRef(new Map<string, Konva.Rect>());
  const panPointerRef = useRef<CanvasPoint | null>(null);
  const suppressGeometryCommitRef = useRef(false);
  const pendingPaints = useRef<PendingPaint[]>([]);
  const animationFrames = useRef(new Set<number>());
  const nextInteractionToken = useRef(1);
  const stateRef = useRef(state);
  stateRef.current = state;

  const enqueuePaint = (
    operation: CanvasOperationName | 'reset',
    started: boolean,
  ): PendingPaint => {
    if (pendingPaints.current.length !== 0) {
      throw new Error('another canvas operation is still pending');
    }
    let resolvePromise: () => void = () => undefined;
    let rejectPromise: (error: Error) => void = () => undefined;
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    void promise.catch(() => undefined);
    const pending: PendingPaint = {
      token: nextInteractionToken.current,
      operation,
      promise,
      resolve: resolvePromise,
      reject: rejectPromise,
      started,
      scheduled: false,
    };
    nextInteractionToken.current += 1;
    pendingPaints.current.push(pending);
    return pending;
  };

  const removePendingPaint = (token: number): void => {
    pendingPaints.current = pendingPaints.current.filter((item) => item.token !== token);
  };

  useImperativeHandle(ref, () => ({
    reset() {
      const pending = enqueuePaint('reset', true);
      nextId.current = 100;
      panPointerRef.current = null;
      draftRef.current = null;
      setDraft(null);
      setIsPanning(false);
      dispatch({ type: 'reset' });
      advanceBenchmarkRevision();
      return pending.promise.finally(() => removePendingPaint(pending.token));
    },
    prepareInteraction(operation) {
      return enqueuePaint(operation, false).token;
    },
    waitForInteraction(token) {
      const pending = pendingPaints.current.find((item) => item.token === token);
      if (pending === undefined) {
        return Promise.reject(new Error(`unknown canvas interaction token: ${token}`));
      }
      return pending.promise.finally(() => removePendingPaint(token));
    },
    getState() {
      return stateRef.current;
    },
  }), []);

  useLayoutEffect(() => {
    const transformer = transformerRef.current;
    if (transformer === null) return;
    const selected = state.selectedId === null ? undefined : boxRefs.current.get(state.selectedId);
    transformer.nodes(selected === undefined ? [] : [selected]);
    transformer.getLayer()?.batchDraw();
  }, [state.selectedId, state.boxes]);

  useLayoutEffect(() => {
    const pending = pendingPaints.current.filter((item) => item.started && !item.scheduled);
    if (pending.length === 0) return undefined;
    for (const item of pending) item.scheduled = true;

    const stage = stageRef.current;
    if (stage === null) {
      for (const item of pending) item.reject(new Error('canvas stage is unavailable'));
      return undefined;
    }
    stage.batchDraw();
    const firstFrame = requestAnimationFrame(() => {
      animationFrames.current.delete(firstFrame);
      const secondFrame = requestAnimationFrame(() => {
        animationFrames.current.delete(secondFrame);
        for (const item of pending) item.resolve();
      });
      animationFrames.current.add(secondFrame);
    });
    animationFrames.current.add(firstFrame);

    return undefined;
  }, [benchmarkRevision, state]);

  useLayoutEffect(() => {
    return () => {
      for (const frame of animationFrames.current) cancelAnimationFrame(frame);
      animationFrames.current.clear();
      const pending = pendingPaints.current.splice(0);
      for (const item of pending) item.reject(new Error('canvas unmounted before paint completed'));
    };
  }, []);

  const commitInteraction = (operation: CanvasOperationName): void => {
    const pending = pendingPaints.current.find((item) => !item.started);
    if (pending === undefined) return;
    if (pending.operation !== operation) {
      pending.scheduled = true;
      pending.reject(
        new Error(`expected ${pending.operation} interaction, received ${operation}`),
      );
      return;
    }
    pending.started = true;
    advanceBenchmarkRevision();
  };

  const rejectInteraction = (operation: CanvasOperationName, reason: string): void => {
    const pending = pendingPaints.current.find(
      (item) => !item.started && item.operation === operation,
    );
    if (pending === undefined) return;
    pending.started = true;
    pending.scheduled = true;
    pending.reject(new Error(reason));
  };

  const restoreGeometryFromState = (): void => {
    for (const box of stateRef.current.boxes) {
      const node = boxRefs.current.get(box.id);
      if (node === undefined) continue;
      node.position({ x: box.x, y: box.y });
      node.size({ width: box.width, height: box.height });
      node.scale({ x: 1, y: 1 });
    }
    transformerRef.current?.forceUpdate();
  };

  const stopGeometryInteractionForPan = (): void => {
    suppressGeometryCommitRef.current = true;
    transformerRef.current?.stopTransform();
    for (const node of boxRefs.current.values()) {
      if (node.isDragging()) node.stopDrag();
    }
    restoreGeometryFromState();
    queueMicrotask(() => {
      suppressGeometryCommitRef.current = false;
    });
  };

  const beginCreate = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void => {
    const stage = event.target.getStage();
    if (stage === null) return;
    if (event.evt instanceof MouseEvent && (event.evt.button === 1 || event.evt.shiftKey)) {
      const pointer = stage.getPointerPosition();
      if (pointer !== null) {
        event.evt.preventDefault();
        panPointerRef.current = pointer;
        stopGeometryInteractionForPan();
        draftRef.current = null;
        setIsPanning(true);
        setDraft(null);
      }
      return;
    }
    if (event.evt instanceof MouseEvent && event.evt.button !== 0) {
      rejectInteraction('create', 'create gesture requires the primary mouse button');
      return;
    }
    if (event.target !== stage && event.target.name() !== 'image-background') {
      rejectInteraction('create', 'create gesture must begin on the image background');
      return;
    }
    const point = toImagePoint(stage);
    if (point === null) {
      rejectInteraction('create', 'create gesture has no pointer position');
      return;
    }
    dispatch({ type: 'select', id: null });
    const nextDraft = { start: point, end: point };
    draftRef.current = nextDraft;
    setDraft(nextDraft);
  };

  const updateCreate = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void => {
    const stage = event.target.getStage();
    if (stage === null) return;
    if (panPointerRef.current !== null) {
      const pointer = stage.getPointerPosition();
      if (pointer !== null) {
        const previous = panPointerRef.current;
        panPointerRef.current = pointer;
        dispatch({
          type: 'pan',
          delta: { x: pointer.x - previous.x, y: pointer.y - previous.y },
        });
      }
      return;
    }
    const currentDraft = draftRef.current;
    if (currentDraft === null) return;
    const point = toImagePoint(stage);
    if (point !== null) {
      const nextDraft = { start: currentDraft.start, end: point };
      draftRef.current = nextDraft;
      setDraft(nextDraft);
    }
  };

  const finishCreate = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void => {
    const stage = event.target.getStage();
    if (panPointerRef.current !== null) {
      const pointer = stage?.getPointerPosition() ?? null;
      if (pointer !== null) {
        const previous = panPointerRef.current;
        const delta = { x: pointer.x - previous.x, y: pointer.y - previous.y };
        if (delta.x !== 0 || delta.y !== 0) dispatch({ type: 'pan', delta });
      }
      commitInteraction('pan');
      panPointerRef.current = null;
      setIsPanning(false);
      for (const box of boxRefs.current.values()) box.draggable(true);
      return;
    }
    const currentDraft = draftRef.current;
    if (currentDraft === null) return;
    const end = stage === null ? currentDraft.end : (toImagePoint(stage) ?? currentDraft.end);
    if (boxFromPoints(currentDraft.start, end) === null) {
      rejectInteraction('create', 'create gesture did not intersect the image with a valid box');
      draftRef.current = null;
      setDraft(null);
      return;
    }
    const id = `box-${nextId.current}`;
    nextId.current += 1;
    commitInteraction('create');
    dispatch({ type: 'create', id, start: currentDraft.start, end });
    draftRef.current = null;
    setDraft(null);
  };

  const cancelPointerGesture = (): void => {
    if (panPointerRef.current !== null) {
      commitInteraction('pan');
      panPointerRef.current = null;
      setIsPanning(false);
      for (const box of boxRefs.current.values()) box.draggable(true);
    }
    if (draftRef.current !== null) {
      rejectInteraction('create', 'create gesture was cancelled before completion');
    }
    draftRef.current = null;
    setDraft(null);
  };

  const draftBox = draft === null ? null : boxFromPoints(draft.start, draft.end);

  return (
    <Stage
      ref={stageRef}
      width={VIEWPORT_WIDTH}
      height={VIEWPORT_HEIGHT}
      x={state.viewport.x}
      y={state.viewport.y}
      scaleX={state.viewport.scale}
      scaleY={state.viewport.scale}
      onMouseDown={beginCreate}
      onMouseMove={updateCreate}
      onMouseUp={finishCreate}
      onMouseLeave={cancelPointerGesture}
      onTouchStart={beginCreate}
      onTouchMove={updateCreate}
      onTouchEnd={finishCreate}
      onTouchCancel={cancelPointerGesture}
      onWheel={(event) => {
        event.evt.preventDefault();
        if (event.evt.shiftKey) {
          stopGeometryInteractionForPan();
          commitInteraction('pan');
          dispatch({
            type: 'pan',
            delta: { x: -event.evt.deltaX, y: -event.evt.deltaY },
          });
          return;
        }
        const pointer = event.target.getStage()?.getPointerPosition();
        if (pointer === null || pointer === undefined) return;
        commitInteraction('zoom');
        dispatch({ type: 'zoom', pointer, factor: event.evt.deltaY < 0 ? 1.1 : 1 / 1.1 });
      }}
    >
      <Layer listening={false}>
        <KonvaImage
          name="image-background"
          image={benchmarkImage}
          x={0}
          y={0}
          width={IMAGE_WIDTH}
          height={IMAGE_HEIGHT}
        />
      </Layer>
      <Layer>
        {state.boxes.map((box) => (
          <Rect
            key={box.id}
            ref={(node) => {
              if (node === null) boxRefs.current.delete(box.id);
              else boxRefs.current.set(box.id, node);
            }}
            {...box}
            draggable={!isPanning}
            stroke={state.selectedId === box.id ? '#f59e0b' : '#38bdf8'}
            strokeWidth={state.selectedId === box.id ? 8 : 4}
            onClick={(event) => {
              event.cancelBubble = true;
              commitInteraction('select');
              dispatch({ type: 'select', id: box.id });
            }}
            onTap={(event) => {
              event.cancelBubble = true;
              commitInteraction('select');
              dispatch({ type: 'select', id: box.id });
            }}
            dragBoundFunc={(position) => {
              return clampDragPosition(position, box, state.viewport);
            }}
            onDragEnd={(event) => {
              if (suppressGeometryCommitRef.current || panPointerRef.current !== null) {
                event.target.position({ x: box.x, y: box.y });
                return;
              }
              commitInteraction('move');
              dispatch({ type: 'move', id: box.id, x: event.target.x(), y: event.target.y() });
            }}
            onTransformEnd={(event) => {
              const node = event.target;
              if (suppressGeometryCommitRef.current || panPointerRef.current !== null) {
                node.position({ x: box.x, y: box.y });
                node.size({ width: box.width, height: box.height });
                node.scale({ x: 1, y: 1 });
                return;
              }
              const candidate = {
                x: node.x(),
                y: node.y(),
                width: node.width() * node.scaleX(),
                height: node.height() * node.scaleY(),
              };
              node.scale({ x: 1, y: 1 });
              if (candidate.width < MIN_BOX_SIZE || candidate.height < MIN_BOX_SIZE) {
                node.position({ x: box.x, y: box.y });
                node.size({ width: box.width, height: box.height });
                transformerRef.current?.forceUpdate();
                return;
              }
              const resized = clampBox(candidate);
              node.position({ x: resized.x, y: resized.y });
              node.size({ width: resized.width, height: resized.height });
              commitInteraction('resize');
              dispatch({ type: 'resize', id: box.id, box: resized });
            }}
          />
        ))}
        {draftBox === null ? null : (
          <Rect {...draftBox} stroke="#22c55e" strokeWidth={4} dash={[20, 12]} listening={false} />
        )}
        <Transformer
          ref={transformerRef}
          rotateEnabled={false}
          keepRatio={false}
          flipEnabled={false}
          ignoreStroke
          boundBoxFunc={(oldBox, newBox) => clampTransformBox(oldBox, newBox, state.viewport)}
        />
      </Layer>
    </Stage>
  );
});

export function summarizeOperationSamples(samples: readonly number[]): OperationMetric {
  if (samples.length === 0 || samples.some((sample) => !Number.isFinite(sample) || sample < 0)) {
    throw new Error('operation samples must be non-empty, finite, and non-negative');
  }
  const sorted = [...samples].sort((left, right) => left - right);
  const meanMs = sorted.reduce((sum, sample) => sum + sample, 0) / sorted.length;
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return {
    meanMs,
    p95Ms: sorted[p95Index] ?? 0,
    maxMs: sorted.at(-1) ?? 0,
  };
}
