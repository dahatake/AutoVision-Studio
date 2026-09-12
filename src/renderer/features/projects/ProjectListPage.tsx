import { useCallback, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { projectListResponseSchema, type ProjectApi, type ProjectIpcErrorCode, type ProjectSnapshot } from '../../../shared/contracts/project-ipc';
import { SystemIcon } from '../../components/SystemIcon';
import './ProjectListPage.css';

export interface ProjectListPageProps {
  api: Pick<ProjectApi, 'list'>;
  onOpen: (snapshot: ProjectSnapshot) => void;
  onCreate: () => void;
  onSettings: (snapshot: ProjectSnapshot) => void;
  // UIR-025 / UIN-06 supplies the real preview navigation; never performs deletion here.
  onDeletePreview?: (snapshot: ProjectSnapshot) => void;
  visible?: boolean;
  refreshKey?: number;
}
type Readout = { items: readonly ProjectSnapshot[] | null; phase: 'loading' | 'ready' | 'failed'; error: ProjectIpcErrorCode | null };
const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });
const searchable = (value: string) => value.normalize('NFC').toLocaleLowerCase('ja-JP');

// Only Project names: bounded inline pages preserve graphemes and all newline forms.
function ProjectName({ name, identity }: { name: string; identity: string }) {
  const id = useId();
  const [page, setPage] = useState(0);
  const pages = useMemo(() => {
    const parts = ['']; let count = 0, breaks = 0;
    for (const { segment } of segmenter.segment(name)) {
      if (count === 40 || breaks === 2) { parts.push(''); count = 0; breaks = 0; }
      parts[parts.length - 1] += segment; count++;
      if (/[\r\n\u2028\u2029]/u.test(segment)) breaks++;
    }
    return parts;
  }, [name]);
  if (pages.length === 1 && !/[\r\n\u2028\u2029]/u.test(name)) return <span title={identity}>{name}</span>;
  return <details className="project-list-page__name-details">
    <summary title={identity} aria-label={`${identity}の名前全文`}>{pages[0].replace(/\s+/gu, ' ')}… 全文</summary>
    <p id={id} className="project-list-page__full-name" tabIndex={0}>{pages[page]}</p>
    <nav aria-label={`${identity}の名前のページ送り`}>
      <button type="button" aria-controls={id} aria-label="名前全文: 前のページ" disabled={page === 0}
        onClick={() => setPage(page - 1)}>前へ</button>
      <span>{page + 1} / {pages.length}</span>
      <button type="button" aria-controls={id} aria-label="名前全文: 次のページ" disabled={page + 1 === pages.length}
        onClick={() => setPage(page + 1)}>次へ</button>
    </nav>
  </details>;
}

// Like the diagnostics context, an API identity change also invalidates A -> B -> A.
export function ProjectListPage(props: ProjectListPageProps) {
  const [context, setContext] = useState({ api: props.api, generation: 0 });
  if (context.api !== props.api) {
    setContext({ api: props.api, generation: context.generation + 1 });
    return null;
  }
  return <ProjectListSession key={context.generation} {...props} />;
}

function ProjectListSession({ api, onOpen, onCreate, onSettings, onDeletePreview, visible = true, refreshKey = 0 }: ProjectListPageProps) {
  const id = useId();
  const [state, setState] = useState<Readout>({ items: null, phase: 'loading', error: null });
  const [query, setQuery] = useState('');
  const [anchor, setAnchor] = useState<string | null>(null);
  // Five estimated 48px rows until DOM measurements exist (also SSR/jsdom fallback).
  const [layout, setLayout] = useState({ width: 0, budget: 240, heights: new Map<string, number>() });
  const root = useRef<HTMLElement>(null), header = useRef<HTMLElement>(null);
  const list = useRef<HTMLUListElement>(null), pager = useRef<HTMLElement>(null);
  const alive = useRef(false), request = useRef<symbol | null>(null);
  const requestedRefreshKey = useRef(refreshKey);
  const refresh = useCallback(async () => {
    if (!alive.current) return;
    const token = Symbol(); request.current = token;
    setState((old) => ({ ...old, phase: 'loading', error: null }));
    try {
      const response = projectListResponseSchema.parse(await api.list());
      if (!alive.current || request.current !== token) return;
      if (response.ok) {
        // Duplicate canonical IDs cannot safely identify rows or callback targets.
        if (new Set(response.value.map(({ project }) => project.id)).size !== response.value.length) throw new Error();
        setState({ items: response.value, phase: 'ready', error: null });
      } else setState((old) => ({ ...old, phase: 'failed', error: response.error.code }));
    } catch {
      if (alive.current && request.current === token) {
        setState((old) => ({ ...old, phase: 'failed', error: 'OPERATION_FAILED' }));
      }
    }
  }, [api]);
  useLayoutEffect(() => {
    alive.current = visible; requestedRefreshKey.current = refreshKey;
    if (visible) void refresh();
    return () => { alive.current = false; request.current = null; };
  }, [refresh, visible, refreshKey]);

  useLayoutEffect(() => {
    if (!visible) return;
    let active = true;
    const measure = () => {
      if (!active || !root.current || !header.current || !pager.current) return;
      const rect = root.current.getBoundingClientRect();
      if (rect.height <= 0 || rect.width <= 0) return;
      const gap = Number.parseFloat(getComputedStyle(root.current).rowGap) || 8;
      const budget = Math.max(1, Math.min(rect.height, window.innerHeight - Math.max(0, rect.top) - 48)
        - header.current.getBoundingClientRect().height - pager.current.getBoundingClientRect().height - gap * 2);
      const rows = Array.from(list.current?.children ?? []);
      setLayout((old) => {
        const width = Math.round(rect.width);
        const heights = width === old.width ? new Map(old.heights) : new Map<string, number>();
        let changed = width !== old.width || budget !== old.budget;
        for (const row of rows) {
          const projectId = row.getAttribute('data-project-id'), height = Math.ceil(row.getBoundingClientRect().height);
          if (projectId && height > 0 && heights.get(projectId) !== height) { heights.set(projectId, height); changed = true; }
        }
        return changed ? { width, budget, heights } : old;
      });
    };
    measure();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    for (const element of [root.current, header.current, pager.current, list.current, ...Array.from(list.current?.children ?? [])]) {
      if (element) observer?.observe(element);
    }
    window.addEventListener('resize', measure);
    return () => { active = false; observer?.disconnect(); window.removeEventListener('resize', measure); };
  });

  const term = searchable(query.trim());
  const filtered = useMemo(() => (state.items ?? []).filter(({ project }) =>
    searchable(project.name).includes(term) || searchable(project.description).includes(term))
    .toSorted((a, b) => Date.parse(b.project.updatedAt) - Date.parse(a.project.updatedAt)), [state.items, term]);
  const pages = useMemo(() => {
    const result: ProjectSnapshot[][] = [[]]; let used = 0;
    for (const snapshot of filtered) {
      let page = result[result.length - 1];
      const height = layout.heights.get(snapshot.project.id) ?? 48;
      if (page.length > 0 && used + height > layout.budget) { page = []; result.push(page); used = 0; }
      page.push(snapshot); used += height;
    }
    return result;
  }, [filtered, layout]);
  const page = Math.max(0, pages.findIndex((items) => items.some(({ project }) => project.id === anchor)));
  const pageItems = pages[page], start = pages.slice(0, page).reduce((sum, items) => sum + items.length, 0);
  // The reveal/key-change commit must not expose old rows as a finished refresh,
  // even before the layout effect starts the new request (including row-focus observers).
  const phase = !alive.current || requestedRefreshKey.current !== refreshKey ? 'loading' : state.phase;
  const stale = state.items !== null && phase !== 'ready';
  const navigate = (index: number) => setAnchor(pages[index][0]?.project.id ?? null);

  if (!visible) return null;
  return <section ref={root} className="project-list-page" aria-labelledby={`${id}-heading`}>
    <header ref={header} className="project-list-page__header">
      <div className="project-list-page__toolbar">
        <h1 id={`${id}-heading`}><SystemIcon name="projects" />Project 一覧</h1>
        <label htmlFor={`${id}-search`}>名前・説明を検索</label>
        <input id={`${id}-search`} type="search" value={query} onChange={(event) => { setQuery(event.target.value); setAnchor(null); }} />
        <button type="button" onClick={() => onCreate()}>Project を作成</button>
        <button type="button" onClick={() => { void refresh(); }}>{phase === 'failed' ? '再試行' : '再取得'}</button>
      </div>
      <p role="status" aria-live="polite" aria-atomic="true">
        {phase === 'loading' ? '取得中' : phase === 'failed' ? `取得失敗（${state.error}）。再試行してください。` : '取得済み'}
        {stale && ' — 前回の一覧（最新ではありません）'}
      </p>
    </header>
    <div aria-busy={phase === 'loading'}>
      <ul ref={list} id={`${id}-list`} className="project-list-page__list" aria-label="Project">
        {pageItems.map((snapshot) => {
          const { project } = snapshot, identity = `${project.name}（${project.id}）`;
          return <li key={project.id} data-project-id={project.id} className="project-list-page__row"
            onFocusCapture={() => setAnchor(project.id)}>
            <div className="project-list-page__name"><ProjectName key={project.name} name={project.name} identity={identity} /></div>
            {/* FR-PRJ-004 is partial: list has no Run/model/capacity facts. Later domain wiring must supply them. */}
            <dl>
              <div><dt>タスク種別</dt><dd>{project.taskType === 'classification' ? '画像分類' : '物体検出'}</dd></div>
              <div><dt>最終更新日時</dt><dd><time dateTime={project.updatedAt}>{new Date(project.updatedAt).toLocaleString('ja-JP', {
                year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
              })}</time></dd></div>
              <div><dt>最新Run状態</dt><dd>未取得</dd></div>
              <div><dt>選択モデル</dt><dd>未取得</dd></div>
              <div><dt>使用容量</dt><dd>未取得</dd></div>
            </dl>
            <div className="project-list-page__actions">
              <button type="button" aria-label={`${identity}を開く`} onClick={() => onOpen(snapshot)}>開く</button>
              <button type="button" aria-label={`${identity}の設定`} onClick={() => onSettings(snapshot)}><SystemIcon name="settings" />設定</button>
              <button type="button" disabled={!onDeletePreview} aria-label={`${identity}の削除対象を確認${onDeletePreview ? '' : '（未実装）'}`}
                onClick={onDeletePreview ? () => onDeletePreview(snapshot) : undefined}>{onDeletePreview ? '削除対象を確認' : '削除（未実装）'}</button>
            </div>
          </li>;
        })}
      </ul>
      {state.items !== null && filtered.length === 0 && <p>{stale ? '前回の一覧に表示対象はありません（最新ではありません）。'
        : state.items.length === 0 ? 'Project は0件です。作成から始められます。' : '検索結果は0件です。検索条件を変更してください。'}</p>}
    </div>
    <nav ref={pager} className="project-list-page__pager" aria-label="Project のページ送り">
      <button type="button" aria-controls={`${id}-list`} aria-label="Project: 最初のページ" disabled={page === 0} onClick={() => navigate(0)}>最初</button>
      <button type="button" aria-controls={`${id}-list`} aria-label="Project: 前のページ" disabled={page === 0} onClick={() => navigate(page - 1)}><SystemIcon name="back" />前へ</button>
      <span>{state.items === null ? '件数 未取得' : `${filtered.length ? start + 1 : 0}–${start + pageItems.length} / ${filtered.length}件（全${state.items.length}件）・${page + 1} / ${pages.length}ページ`}</span>
      <button type="button" aria-controls={`${id}-list`} aria-label="Project: 次のページ" disabled={page + 1 === pages.length} onClick={() => navigate(page + 1)}>次へ</button>
      <button type="button" aria-controls={`${id}-list`} aria-label="Project: 最後のページ" disabled={page + 1 === pages.length}
        onClick={() => setAnchor(filtered.at(-1)?.project.id ?? null)}>最後</button>
    </nav>
  </section>;
}