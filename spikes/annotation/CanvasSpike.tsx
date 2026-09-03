import Konva from 'konva';
import { useLayoutEffect, useReducer, useRef, useState } from 'react';
import { Layer, Rect, Stage, Transformer } from 'react-konva';

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

export interface CanvasState {
  readonly boxes: readonly CanvasBox[];
  readonly selectedId: string | null;
  readonly viewport: CanvasViewport;
}

export type CanvasAction =
  | { readonly type: 'select'; readonly id: string | null }
  | { readonly type: 'create'; readonly id: string; readonly start: CanvasPoint; readonly end: CanvasPoint }
  | { readonly type: 'move'; readonly id: string; readonly x: number; readonly y: number }
  | { readonly type: 'resize'; readonly id: string; readonly box: Omit<CanvasBox, 'id'> }
  | { readonly type: 'zoom'; readonly pointer: CanvasPoint; readonly factor: number };

export interface OperationMetric {
  readonly meanMs: number;
  readonly p95Ms: number;
  readonly maxMs: number;
}

export interface CanvasBenchmarkResult {
  readonly logicalImage: { readonly width: number; readonly height: number };
  readonly initialBoxCount: number;
  readonly samplesPerOperation: number;
  readonly operations: Readonly<Record<'create' | 'select' | 'move' | 'resize' | 'zoom', OperationMetric>>;
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

  const width = Math.min(IMAGE_WIDTH, Math.max(MIN_BOX_SIZE, box.width));
  const height = Math.min(IMAGE_HEIGHT, Math.max(MIN_BOX_SIZE, box.height));
  const x = Math.min(IMAGE_WIDTH - width, Math.max(0, box.x));
  const y = Math.min(IMAGE_HEIGHT - height, Math.max(0, box.y));
  return { x, y, width, height };
}

function boxFromPoints(start: CanvasPoint, end: CanvasPoint): Omit<CanvasBox, 'id'> | null {
  const raw = {
    x: Math.min(start.x, end.x),
    y: Math.min(start.y, end.y),
    width: Math.abs(end.x - start.x),
    height: Math.abs(end.y - start.y),
  };
  if (raw.width < MIN_BOX_SIZE || raw.height < MIN_BOX_SIZE) {
    return null;
  }
  return clampBox(raw);
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
      return {
        ...state,
        boxes: state.boxes.map((box) =>
          box.id === action.id ? { id: box.id, ...clampBox(action.box) } : box,
        ),
      };
    case 'zoom': {
      requireFinite(action.factor, 'zoom factor');
      if (action.factor <= 0) return state;
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

export function CanvasSpike(): React.JSX.Element {
  const [state, dispatch] = useReducer(reduceCanvasState, undefined, createInitialCanvasState);
  const [draft, setDraft] = useState<{ readonly start: CanvasPoint; readonly end: CanvasPoint } | null>(null);
  const nextId = useRef(100);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const boxRefs = useRef(new Map<string, Konva.Rect>());

  useLayoutEffect(() => {
    const transformer = transformerRef.current;
    if (transformer === null) return;
    const selected = state.selectedId === null ? undefined : boxRefs.current.get(state.selectedId);
    transformer.nodes(selected === undefined ? [] : [selected]);
    transformer.getLayer()?.batchDraw();
  }, [state.selectedId, state.boxes]);

  const beginCreate = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void => {
    const stage = event.target.getStage();
    if (stage === null) return;
    if (event.target !== stage && event.target.name() !== 'image-background') return;
    const point = toImagePoint(stage);
    if (point === null) return;
    dispatch({ type: 'select', id: null });
    setDraft({ start: point, end: point });
  };

  const updateCreate = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>): void => {
    if (draft === null) return;
    const stage = event.target.getStage();
    if (stage === null) return;
    const point = toImagePoint(stage);
    if (point !== null) setDraft({ start: draft.start, end: point });
  };

  const finishCreate = (): void => {
    if (draft === null) return;
    const id = `box-${nextId.current}`;
    nextId.current += 1;
    dispatch({ type: 'create', id, start: draft.start, end: draft.end });
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
      onTouchStart={beginCreate}
      onTouchMove={updateCreate}
      onTouchEnd={finishCreate}
      onWheel={(event) => {
        event.evt.preventDefault();
        const pointer = event.target.getStage()?.getPointerPosition();
        if (pointer === null || pointer === undefined) return;
        dispatch({ type: 'zoom', pointer, factor: event.evt.deltaY < 0 ? 1.1 : 1 / 1.1 });
      }}
    >
      <Layer>
        <Rect
          name="image-background"
          x={0}
          y={0}
          width={IMAGE_WIDTH}
          height={IMAGE_HEIGHT}
          fill="#18181b"
        />
        {state.boxes.map((box) => (
          <Rect
            key={box.id}
            ref={(node) => {
              if (node === null) boxRefs.current.delete(box.id);
              else boxRefs.current.set(box.id, node);
            }}
            {...box}
            draggable
            stroke={state.selectedId === box.id ? '#f59e0b' : '#38bdf8'}
            strokeWidth={state.selectedId === box.id ? 8 : 4}
            onClick={(event) => {
              event.cancelBubble = true;
              dispatch({ type: 'select', id: box.id });
            }}
            onTap={(event) => {
              event.cancelBubble = true;
              dispatch({ type: 'select', id: box.id });
            }}
            dragBoundFunc={(position) => {
              const clamped = clampBox({ ...box, x: position.x, y: position.y });
              return { x: clamped.x, y: clamped.y };
            }}
            onDragEnd={(event) => {
              dispatch({ type: 'move', id: box.id, x: event.target.x(), y: event.target.y() });
            }}
            onTransformEnd={(event) => {
              const node = event.target;
              const resized = {
                x: node.x(),
                y: node.y(),
                width: node.width() * node.scaleX(),
                height: node.height() * node.scaleY(),
              };
              node.scale({ x: 1, y: 1 });
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
          boundBoxFunc={(oldBox, newBox) =>
            newBox.width < MIN_BOX_SIZE || newBox.height < MIN_BOX_SIZE ? oldBox : newBox
          }
        />
      </Layer>
    </Stage>
  );
}

function summarize(samples: readonly number[]): OperationMetric {
  const sorted = [...samples].sort((left, right) => left - right);
  const meanMs = sorted.reduce((sum, sample) => sum + sample, 0) / sorted.length;
  const p95Index = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return {
    meanMs,
    p95Ms: sorted[p95Index] ?? 0,
    maxMs: sorted.at(-1) ?? 0,
  };
}

export function measureCanvasOperations(
  container: HTMLDivElement,
  samplesPerOperation = 100,
): CanvasBenchmarkResult {
  const stage = new Konva.Stage({
    container,
    width: VIEWPORT_WIDTH,
    height: VIEWPORT_HEIGHT,
    scaleX: 0.25,
    scaleY: 0.25,
  });
  const layer = new Konva.Layer();
  stage.add(layer);
  layer.add(new Konva.Rect({ x: 0, y: 0, width: IMAGE_WIDTH, height: IMAGE_HEIGHT, fill: '#18181b' }));
  const nodes = createInitialBoxes().map((box) => {
    const node = new Konva.Rect({ ...box, stroke: '#38bdf8', strokeWidth: 4 });
    layer.add(node);
    return node;
  });
  layer.draw();

  const samples: Record<'create' | 'select' | 'move' | 'resize' | 'zoom', number[]> = {
    create: [],
    select: [],
    move: [],
    resize: [],
    zoom: [],
  };
  const measure = (operation: keyof typeof samples, action: (index: number) => void): void => {
    for (let index = 0; index < samplesPerOperation; index += 1) {
      const start = performance.now();
      action(index);
      samples[operation].push(performance.now() - start);
    }
  };

  try {
    measure('create', (index) => {
      const node = new Konva.Rect({ x: index * 3, y: index * 2, width: 80, height: 60, stroke: '#22c55e' });
      layer.add(node);
      layer.draw();
      node.destroy();
    });
    measure('select', (index) => {
      const node = nodes[index % nodes.length];
      if (node === undefined) throw new Error('benchmark selection node is missing');
      node.stroke(index % 2 === 0 ? '#f59e0b' : '#38bdf8');
      node.strokeWidth(index % 2 === 0 ? 8 : 4);
      layer.draw();
    });
    measure('move', (index) => {
      const node = nodes[index % nodes.length];
      if (node === undefined) throw new Error('benchmark move node is missing');
      node.position({ x: (node.x() + 7) % 3500, y: (node.y() + 5) % 1950 });
      layer.draw();
    });
    measure('resize', (index) => {
      const node = nodes[index % nodes.length];
      if (node === undefined) throw new Error('benchmark resize node is missing');
      node.size({ width: 180 + (index % 5) * 10, height: 90 + (index % 3) * 10 });
      layer.draw();
    });
    measure('zoom', (index) => {
      const scale = index % 2 === 0 ? 0.3 : 0.25;
      stage.scale({ x: scale, y: scale });
      stage.position({ x: 480 - 1920 * scale, y: 270 - 1080 * scale });
      stage.draw();
    });

    return {
      logicalImage: { width: IMAGE_WIDTH, height: IMAGE_HEIGHT },
      initialBoxCount: nodes.length,
      samplesPerOperation,
      operations: {
        create: summarize(samples.create),
        select: summarize(samples.select),
        move: summarize(samples.move),
        resize: summarize(samples.resize),
        zoom: summarize(samples.zoom),
      },
    };
  } finally {
    stage.destroy();
  }
}
