import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { renderPage, type LoadedDoc } from '../lib/engine';
import type { BBox, Change, DiffResult, PageData } from '../lib/types';
import type { Filter } from './Sidebar';

export interface ViewState { zoom: number; x: number; y: number; focus?: BBox }

interface Props {
  result: DiffResult; docA: LoadedDoc; docB: LoadedDoc; pair: number;
  view: ViewState; setView: (v: ViewState) => void;
  selected: string | null; filter: Filter; onSelect: (id: string) => void;
}

const MAX_CANVAS_PX = 5000;

function useSize(ref: React.RefObject<HTMLDivElement | null>) {
  const [s, setS] = useState({ w: 600, h: 800 });
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const ro = new ResizeObserver(() => setS({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setS({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [ref]);
  return s;
}

function Pane({ side, doc, pageIdx, page, changes, view, setView, selected, onSelect, rev, label, offset }: {
  offset: [number, number];
  side: 'A' | 'B'; doc: LoadedDoc; pageIdx: number | null; page: PageData | null; changes: Change[];
  view: ViewState; setView: (v: ViewState) => void; selected: string | null; onSelect: (id: string) => void; rev?: string | null; label: string;
}) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const { w: cw, h: ch } = useSize(box);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const fit = page ? Math.min(cw / page.width, ch / page.height) * 0.94 : 1;
  const zoom = view.zoom > 0 ? view.zoom : 1;
  const eff = fit * zoom;

  // (re)render the page bitmap for the current effective scale (debounced while zooming)
  useEffect(() => {
    if (!page || pageIdx === null || !canvas.current) return;
    const dpr = window.devicePixelRatio || 1;
    let s = eff * dpr;
    const maxDim = Math.max(page.width, page.height) * s;
    if (maxDim > MAX_CANVAS_PX) s *= MAX_CANVAS_PX / maxDim;
    let stale = false;
    const t = setTimeout(async () => {
      try {
        const tmp = await renderPage(doc.pdf, pageIdx, s); // render off-screen, then blit (no concurrent renders on one canvas)
        const c = canvas.current; if (stale || !c) return;
        c.width = tmp.width; c.height = tmp.height; c.getContext('2d')!.drawImage(tmp, 0, 0);
      } catch { /* superseded */ }
    }, 60);
    return () => { stale = true; clearTimeout(t); };
  }, [doc, pageIdx, page, Math.round(eff * 100)]);

  const vis = changes.filter(c => (side === 'A' ? c.bboxA : c.bboxB));
  const wPx = (page?.width ?? 0) * eff, hPx = (page?.height ?? 0) * eff;
  const left = (cw - wPx) / 2 + view.x, top = (ch - hPx) / 2 + view.y;

  const onWheel = (e: React.WheelEvent) => {
    if (!page) return;
    const r = box.current!.getBoundingClientRect();
    const mx = e.clientX - r.left, my = e.clientY - r.top;
    const z2 = Math.min(40, Math.max(0.5, zoom * Math.exp(-e.deltaY * 0.0015)));
    const k = z2 / zoom;
    setView({ zoom: z2, x: mx - cw / 2 - (mx - cw / 2 - view.x) * k, y: my - ch / 2 - (my - ch / 2 - view.y) * k });
  };
  return (
    <div className="pane">
      <div className="ph">
        <span className={`tag ${side === 'A' ? 'ta' : 'tb'}`}>{side}</span>
        <b>{rev ? `Rev ${rev}` : side === 'A' ? 'Rev A' : 'Rev B'}</b>
        <span className="ellip">· {doc.data.name} · {pageIdx !== null ? `page ${pageIdx + 1}` : 'no page'}</span>
        <span className="sp" />
        <span className="muted">{label}</span>
      </div>
      <div className="pc" ref={box} data-testid={`pane-${side.toLowerCase()}`} onWheel={onWheel}
        onPointerDown={e => { (e.target as HTMLElement).setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y }; }}
        onPointerMove={e => { const d = drag.current; if (d) setView({ zoom, x: d.vx + e.clientX - d.x, y: d.vy + e.clientY - d.y }); }}
        onPointerUp={() => { drag.current = null; }}>
        {page ? (
          <div className="sheetwrap" style={{ left, top, width: wPx, height: hPx }}>
            <canvas ref={canvas} style={{ width: wPx, height: hPx }} />
            <svg className="hl" viewBox={`0 0 ${page.width} ${page.height}`} width={wPx} height={hPx}>
              <defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 z" fill="#b9adff" /></marker></defs>
              {side === 'B' && vis.filter(c => (c.op === 'moved' || c.op === 'resized') && c.bboxA && c.bboxB).map(c => {
                // ghost of the old position (in B's frame) and an arrow to the new one
                const a = c.bboxA!, b = c.bboxB!, g: BBox = [a[0] + offset[0], a[1] + offset[1], a[2] + offset[0], a[3] + offset[1]];
                const sw = 1.4 / eff;
                return (
                  <g key={c.id + 'g'} className={`ghost ${selected === c.id ? 'sel' : ''}`} style={{ strokeWidth: sw }} pointerEvents="none">
                    <rect x={g[0]} y={g[1]} width={g[2] - g[0]} height={g[3] - g[1]} style={{ strokeDasharray: `${4 / eff} ${3 / eff}` }} />
                    <line x1={(g[0] + g[2]) / 2} y1={(g[1] + g[3]) / 2} x2={(b[0] + b[2]) / 2} y2={(b[1] + b[3]) / 2} markerEnd="url(#arrow)" />
                  </g>
                );
              })}
              {vis.map(c => {
                const b = (side === 'A' ? c.bboxA : c.bboxB) as BBox;
                const p = Math.max(1.5, 3 / eff);
                return (
                  <rect key={c.id} x={b[0] - p} y={b[1] - p} width={b[2] - b[0] + 2 * p} height={b[3] - b[1] + 2 * p} rx={p}
                    className={`h-${c.op} k-${c.kind} ${c.foldKey ? 'folded' : ''} ${selected === c.id ? 'sel' : ''}`}
                    style={{ strokeWidth: (selected === c.id ? 3 : 1.6) / eff }}
                    onPointerDown={e => e.stopPropagation()} onClick={() => onSelect(c.id)}>
                    <title>{c.kind} {c.op}{c.before ? ` "${c.before}"` : ''}{c.after ? ` → "${c.after}"` : ''}</title>
                  </rect>
                );
              })}
            </svg>
          </div>
        ) : (
          <div className="nopage">No matching page in {side === 'A' ? 'Rev A' : 'Rev B'}<br /><span className="muted">{side === 'A' ? 'Inserted in Rev B' : 'Deleted from Rev A'}</span></div>
        )}
        <div className="zoom">{Math.round(zoom * 100)}%</div>
      </div>
    </div>
  );
}

export default function Viewer({ result, docA, docB, pair, view, setView, selected, filter, onSelect }: Props) {
  const p = result.pairs[pair];
  const pr = result.perPair[pair];
  const pageA = p.a !== null ? docA.data.pages[p.a] : null, pageB = p.b !== null ? docB.data.pages[p.b] : null;
  const changes = (pr?.changes ?? []).filter(c => filter === 'all' || c.kind === filter || c.kind === 'page');
  const wrap = useRef<HTMLDivElement>(null);
  // resolve a focus request (from the change list) into zoom + pan, using the B pane (or A) geometry
  useEffect(() => {
    if (!view.focus || !wrap.current) return;
    const pg = pageB ?? pageA; if (!pg) return;
    const pane = wrap.current.querySelector('.pc') as HTMLDivElement | null; if (!pane) return;
    const cw = pane.clientWidth, ch = pane.clientHeight;
    const fit = Math.min(cw / pg.width, ch / pg.height) * 0.94;
    const b = view.focus, bw = Math.max(8, b[2] - b[0]), bh = Math.max(8, b[3] - b[1]);
    const zoom = Math.min(12, Math.max(1.5, Math.min((0.4 * cw) / (bw * fit), (0.4 * ch) / (bh * fit))));
    const eff = fit * zoom;
    // centre the change, but don't pan past the page edges when the page is larger than the pane
    const clamp = (v: number, page: number, pane: number) => { const lim = Math.max(0, (page - pane) / 2); return Math.max(-lim, Math.min(lim, v)); };
    setView({ zoom, x: clamp((pg.width / 2 - (b[0] + b[2]) / 2) * eff, pg.width * eff, cw), y: clamp((pg.height / 2 - (b[1] + b[3]) / 2) * eff, pg.height * eff, ch) });
  }, [view.focus]);
  return (
    <div className="panes" ref={wrap}>
      <Pane side="A" offset={pr?.offset ?? [0, 0]} doc={docA} pageIdx={p.a} page={pageA} changes={changes} view={view} setView={setView} selected={selected} onSelect={onSelect} rev={p.a !== null ? result.sheetsA[p.a]?.rev : null} label={p.label} />
      <Pane side="B" offset={pr?.offset ?? [0, 0]} doc={docB} pageIdx={p.b} page={pageB} changes={changes} view={view} setView={setView} selected={selected} onSelect={onSelect} rev={p.b !== null ? result.sheetsB[p.b]?.rev : null} label={p.label} />
    </div>
  );
}
