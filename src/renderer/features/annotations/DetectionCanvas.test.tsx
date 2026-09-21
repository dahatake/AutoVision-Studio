import { act, render, screen, within, getDefaultNormalizer } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DetectionCanvas } from './DetectionCanvas';
import { MAX_SCALE, displayToImage, type Viewport } from './canvas-coordinates';

/** Konva draws onto a real 2D context, which jsdom does not implement and which
 * the dependency record deliberately does not cover with the optional `canvas`
 * package (docs/dependency-adoption/node-phase-c.md). Konva nodes are therefore
 * replaced by inert recorders: the assertions below check the geometry this
 * component hands to Konva, not Konva's own rasterisation (measured separately
 * in SPI-10). */
const konva = vi.hoisted(() => ({ nodes: [] as { name: string; props: Record<string, unknown> }[] }));
vi.mock('react-konva', async () => {
  const { createElement } = await import('react');
  const recorder = (name: string) => function KonvaNode({ children, ...props }: Record<string, unknown> & { children?: unknown }) {
    konva.nodes.push({ name, props });
    return createElement('div', { 'data-konva': name }, children as never);
  };
  return {
    Stage: recorder('Stage'), Layer: recorder('Layer'), Image: recorder('Image'),
    Rect: recorder('Rect'), Group: recorder('Group'), Text: recorder('Text'), Transformer: recorder('Transformer'),
  };
});

function latest(name: string): Record<string, unknown> | undefined {
  return konva.nodes.filter((node) => node.name === name).at(-1)?.props;
}
function stageViewport(): Viewport {
  const props = latest('Stage')!;
  return { scale: props.scaleX as number, offsetX: props.x as number, offsetY: props.y as number };
}

class FakeImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  #src = '';
  static instances: FakeImage[] = [];
  constructor() { FakeImage.instances.push(this); }
  get src(): string { return this.#src; }
  set src(value: string) {
    this.#src = value;
    queueMicrotask(() => { if (value === 'av-image://broken') this.onerror?.(); else this.onload?.(); });
  }
}

const imageSize = { width: 4000, height: 2000 };
const containerSize = { width: 1000, height: 1000 };

beforeEach(() => {
  konva.nodes.length = 0;
  FakeImage.instances.length = 0;
  vi.stubGlobal('Image', FakeImage);
});

describe('DetectionCanvas W2-15', () => {
  it('always shows the Project policy panel inside the canvas, passed through unmodified', () => {
    const policy = '極小：一辺8px未満は対象外。\n曖昧境界：不明瞭な境界は最も確からしい輪郭で囲む。';
    render(<DetectionCanvas instructions={policy} imageUrl="av-image://project/item.png"
      imageSize={imageSize} containerSize={containerSize} />);
    const canvas = screen.getByRole('region', { name: '検出キャンバス' });
    const panel = within(canvas).getByRole('region', { name: '作業指示' });
    expect(within(panel).getByText(policy, { normalizer: getDefaultNormalizer({ collapseWhitespace: false, trim: false }) }).textContent).toBe(policy);
  });

  it('honestly shows the unset notice inside the canvas when no policy is configured', () => {
    render(<DetectionCanvas instructions="" imageUrl="av-image://project/item.png"
      imageSize={imageSize} containerSize={containerSize} />);
    const canvas = screen.getByRole('region', { name: '検出キャンバス' });
    expect(within(canvas).getByRole('region', { name: '作業指示' })).toHaveTextContent('まだ設定されていません');
  });
});

describe('DetectionCanvas W2-10', () => {
  it('fits the image on mount and draws it at its own pixel size inside the scaled stage', async () => {
    render(<DetectionCanvas instructions="" imageUrl="av-image://project/item.png" imageSize={imageSize} containerSize={containerSize} />);
    expect(await screen.findByText('表示倍率 25% ／ 表示位置 X 0, Y 250')).toBeInTheDocument();
    expect(stageViewport()).toEqual({ scale: 0.25, offsetX: 0, offsetY: 250 });
    expect(latest('Stage')).toMatchObject({ width: 1000, height: 1000, scaleY: 0.25, draggable: true });
    expect(latest('Image')).toMatchObject({ x: 0, y: 0, width: 4000, height: 2000, listening: false });
    expect((latest('Image')!.image as FakeImage).src).toBe('av-image://project/item.png');
  });

  it('reports a load failure instead of leaving a blank canvas that looks loaded', async () => {
    render(<DetectionCanvas instructions="" imageUrl="av-image://broken" imageSize={imageSize} containerSize={containerSize} />);
    expect(await screen.findByText('画像を読み込めません')).toBeInTheDocument();
    expect(latest('Image')).toBeUndefined();
    expect(latest('Stage')).toBeDefined();
  });

  it('zooms about the container centre with keyboard and buttons, keeping that image pixel anchored', async () => {
    const user = userEvent.setup();
    render(<DetectionCanvas instructions="" imageUrl="av-image://project/item.png" imageSize={imageSize} containerSize={containerSize} />);
    const centre = { x: 500, y: 500 };
    const before = displayToImage(centre, stageViewport())!;
    await user.click(screen.getByRole('button', { name: '拡大' }));
    expect(stageViewport().scale).toBeCloseTo(0.3125, 10);
    expect(displayToImage(centre, stageViewport())!.x).toBeCloseTo(before.x, 6);
    expect(displayToImage(centre, stageViewport())!.y).toBeCloseTo(before.y, 6);
    expect(screen.getByRole('status')).toHaveTextContent('表示倍率 31%');
    await user.click(screen.getByRole('button', { name: '縮小' }));
    expect(stageViewport().scale).toBeCloseTo(0.25, 10);
    expect(screen.getByRole('button', { name: '縮小' })).toHaveFocus();
    await user.tab();
    await user.tab();
    expect(screen.getByLabelText('画像表示領域（矢印キーで移動、プラスとマイナスで拡大縮小）')).toHaveFocus();
    await user.keyboard('+');
    expect(stageViewport().scale).toBeCloseTo(0.3125, 10);
    await user.keyboard('-');
    expect(stageViewport().scale).toBeCloseTo(0.25, 10);
  });

  it('pans with the arrow keys and restores the fitted view on demand', async () => {
    const user = userEvent.setup();
    render(<DetectionCanvas instructions="" imageUrl="av-image://project/item.png" imageSize={imageSize} containerSize={containerSize} />);
    const region = screen.getByLabelText('画像表示領域（矢印キーで移動、プラスとマイナスで拡大縮小）');
    region.focus();
    await user.keyboard('{ArrowRight}');
    expect(stageViewport()).toEqual({ scale: 0.25, offsetX: -48, offsetY: 250 });
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(stageViewport()).toEqual({ scale: 0.25, offsetX: -48, offsetY: 154 });
    await user.keyboard('{ArrowLeft}{ArrowUp}');
    expect(stageViewport()).toEqual({ scale: 0.25, offsetX: 0, offsetY: 202 });
    await user.click(screen.getByRole('button', { name: '全体表示' }));
    expect(stageViewport()).toEqual({ scale: 0.25, offsetX: 0, offsetY: 250 });
  });

  it('adopts the offset produced by dragging the stage', async () => {
    render(<DetectionCanvas instructions="" imageUrl="av-image://project/item.png" imageSize={imageSize} containerSize={containerSize} />);
    expect(await screen.findByText(/表示倍率 25%/u)).toBeInTheDocument();
    const onDragEnd = latest('Stage')!.onDragEnd as (event: unknown) => void;
    const stage: { x: () => number; y: () => number; getStage: () => unknown } = {
      x: () => -120, y: () => 60, getStage: () => stage,
    };
    act(() => onDragEnd({ target: stage }));
    expect(stageViewport()).toEqual({ scale: 0.25, offsetX: -120, offsetY: 60 });
    expect(screen.getByRole('status')).toHaveTextContent('表示位置 X -120, Y 60');
  });

  it('ignores a drag that bubbled up from a rectangle inside the stage', async () => {
    render(<DetectionCanvas instructions="" imageUrl="av-image://project/item.png" imageSize={imageSize} containerSize={containerSize} />);
    expect(await screen.findByText(/表示倍率 25%/u)).toBeInTheDocument();
    const onDragEnd = latest('Stage')!.onDragEnd as (event: unknown) => void;
    const stage = { x: () => -120, y: () => 60 };
    // A rectangle reports image pixels; adopting them would teleport the view.
    act(() => onDragEnd({ target: { x: () => 100, y: () => 80, getStage: () => stage } }));
    expect(stageViewport()).toEqual({ scale: 0.25, offsetX: 0, offsetY: 250 });
  });

  it('refuses a zoom past the supported range and keeps the current view', async () => {
    const user = userEvent.setup();
    render(<DetectionCanvas instructions="" imageUrl="av-image://project/item.png" imageSize={{ width: 8, height: 8 }} containerSize={{ width: 1000, height: 1000 }} />);
    expect(stageViewport().scale).toBe(MAX_SCALE);
    await user.click(screen.getByRole('button', { name: '拡大' }));
    expect(stageViewport().scale).toBe(MAX_SCALE);
    expect(screen.getByRole('alert')).toHaveTextContent('これ以上拡大できません（上限 6400%）');
  });

  it('refuses to render a stage when the container cannot fit a single scaled pixel', () => {
    const onViewportChange = vi.fn<(viewport: Viewport | null) => void>();
    render(<DetectionCanvas instructions="" imageUrl="av-image://project/item.png" imageSize={{ width: 4000, height: 4000 }}
      containerSize={{ width: 10, height: 10 }} onViewportChange={onViewportChange} />);
    expect(screen.getByRole('status')).toHaveTextContent('表示領域が小さすぎて画像を表示できません');
    expect(latest('Stage')).toBeUndefined();
    expect(onViewportChange).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('button', { name: '拡大' })).toBeDisabled();
  });
});
