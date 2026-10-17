import type { BBox, Word } from './types';
import type { Shape } from './vector';

/** Drawing border grid (zone labels along the frame): column/row labels and the cell edges between them. */
export interface GridInfo {
  cols: string[]; // left to right as printed (e.g. ["8", ..., "1"] on ASME sheets)
  xedges: number[]; // cols.length + 1 edges, ascending
  rows: string[]; // top to bottom as printed (e.g. ["D", ..., "A"])
  yedges: number[];
  confidence: 'high' | 'medium';
  /** where the cell edges came from */
  edges: 'ticks' | 'labels';
}

const isNum = (t: string) => /^\d{1,2}$/.test(t);
const isAlpha = (t: string) => /^[A-Z]$/.test(t);

type Cand = { label: string; pos: number };

/** Best evenly spaced label sequence (1,2,3.. or A,B,C..; either direction) on one of the given edges. */
function axis(cands: Record<string, Cand[]>, edges: string[], kind: 'num' | 'alpha') {
  let best: { score: number; keys: string[]; pos: number[]; edge: string } | null = null;
  for (const e of edges) {
    const d = new Map<string, number>();
    for (const c of cands[e]) if ((kind === 'num' ? isNum(c.label) : isAlpha(c.label)) && !d.has(c.label)) d.set(c.label, c.pos);
    if (d.size < 3) continue;
    const val = (k: string) => (kind === 'num' ? parseInt(k, 10) : k.charCodeAt(0));
    const keys = [...d.keys()].sort((p, q) => val(p) - val(q));
    const vals = keys.map(val);
    if (vals.some((v, i) => v !== vals[0] + i)) continue; // must be a consecutive sequence
    const pos = keys.map(k => d.get(k)!);
    const gaps = pos.slice(1).map((p, i) => p - pos[i]);
    if (!(gaps.every(g => g > 0) || gaps.every(g => g < 0))) continue; // monotonic in either direction
    const ag = gaps.map(Math.abs), mean = ag.reduce((s, g) => s + g, 0) / ag.length;
    const reg = Math.sqrt(ag.reduce((s, g) => s + (g - mean) ** 2, 0) / ag.length) / mean;
    if (reg > 0.15) continue; // evenly spaced
    const score = keys.length - reg;
    if (!best || score > best.score) best = { score, keys, pos, edge: e };
  }
  return best;
}

/**
 * Detect a border grid from zone labels in a band along the page edges (5 % of the shorter side, min 40 pt).
 * Works for either label direction (ISO: 1.. left to right, A.. top to bottom; ASME: 8..1 and D..A).
 * Cell edges come from border tick marks when the page has them (short lines perpendicular to the frame, between
 * labels), otherwise from the midpoints between label centres.
 */
export function detectGrid(words: Word[], W: number, H: number, shapes: Shape[] = []): GridInfo | null {
  const band = Math.max(40, 0.05 * Math.min(W, H));
  const cands: Record<string, Cand[]> = { top: [], bottom: [], left: [], right: [] };
  for (const w of words) {
    const t = w.text;
    if (!(isNum(t) || isAlpha(t))) continue;
    const x = (w.bbox[0] + w.bbox[2]) / 2, y = (w.bbox[1] + w.bbox[3]) / 2;
    if (y < band) cands.top.push({ label: t, pos: x });
    else if (y > H - band) cands.bottom.push({ label: t, pos: x });
    else if (x < band) cands.left.push({ label: t, pos: y });
    else if (x > W - band) cands.right.push({ label: t, pos: y });
  }
  const cols = axis(cands, ['top', 'bottom'], 'num') ?? axis(cands, ['top', 'bottom'], 'alpha');
  const rows = axis(cands, ['left', 'right'], 'alpha') ?? axis(cands, ['left', 'right'], 'num');
  if (!cols || !rows) return null;
  // tick marks: short straight segments in the band, perpendicular to the edge
  const vTicks: number[] = [], hTicks: number[] = [];
  for (const s of shapes) {
    if (s.paint === 'fill') continue;
    const [x0, y0, x1, y1] = s.bbox, w = x1 - x0, h = y1 - y0;
    const inV = y1 < band || y0 > H - band, inH = x1 < band || x0 > W - band;
    if (inV && w < 0.6 && h >= 3 && h <= 60) vTicks.push((x0 + x1) / 2);
    if (inH && h < 0.6 && w >= 3 && w <= 60) hTicks.push((y0 + y1) / 2);
  }
  const edgesFor = (keys: string[], pos: number[], ticks: number[], limit: number) => {
    const order = pos.map((_, i) => i).sort((i, j) => pos[i] - pos[j]);
    const k = order.map(i => keys[i]), p = order.map(i => pos[i]);
    const step = (p[p.length - 1] - p[0]) / (p.length - 1);
    const near = (target: number) => {
      let best: number | null = null;
      for (const t of ticks) if (Math.abs(t - target) <= 0.3 * step && (best === null || Math.abs(t - target) < Math.abs(best - target))) best = t;
      return best;
    };
    let found = 0;
    const edges: number[] = [];
    for (let i = 0; i <= p.length; i++) {
      const mid = i === 0 ? p[0] - step / 2 : i === p.length ? p[p.length - 1] + step / 2 : (p[i - 1] + p[i]) / 2;
      const t = near(mid);
      if (t !== null && i > 0 && i < p.length) found++;
      edges.push(Math.max(0, Math.min(limit, t ?? mid)));
    }
    return { keys: k, edges, tickRatio: p.length > 1 ? found / (p.length - 1) : 0 };
  };
  const cx = edgesFor(cols.keys, cols.pos, vTicks, W), ry = edgesFor(rows.keys, rows.pos, hTicks, H);
  const both = (cands.top.length >= 3 && cands.bottom.length >= 3 ? 1 : 0) + (cands.left.length >= 3 && cands.right.length >= 3 ? 1 : 0);
  return {
    cols: cx.keys, xedges: cx.edges, rows: ry.keys, yedges: ry.edges,
    confidence: both === 2 ? 'high' : 'medium',
    edges: cx.tickRatio >= 0.8 && ry.tickRatio >= 0.8 ? 'ticks' : 'labels',
  };
}

function cellIndex(edges: number[], v: number): number {
  let i = 0;
  while (i < edges.length - 2 && v >= edges[i + 1]) i++;
  return i;
}

/** Cell label (row + column, e.g. "D3") at a point. */
export function cellAt(g: GridInfo, x: number, y: number): string {
  return g.rows[cellIndex(g.yedges, y)] + g.cols[cellIndex(g.xedges, x)];
}

const colNum = (c: string) => (/^\d+$/.test(c) ? parseInt(c, 10) : c.charCodeAt(0));

/** Grid reference of a box: one cell ("D3") or a range ("B1–C2", rows and columns in label order). */
export function gridRef(g: GridInfo, b: BBox): string {
  const r0 = g.rows[cellIndex(g.yedges, b[1])], r1 = g.rows[cellIndex(g.yedges, b[3])];
  const c0 = g.cols[cellIndex(g.xedges, b[0])], c1 = g.cols[cellIndex(g.xedges, b[2])];
  if (r0 === r1 && c0 === c1) return r0 + c0;
  const rs = [r0, r1].sort(), cs = [c0, c1].sort((p, q) => colNum(p) - colNum(q));
  return `${rs[0]}${cs[0]}–${rs[1]}${cs[1]}`;
}

/** Sort key of a grid reference: row label, then numeric column. */
export function gridSortKey(ref: string | null): [string, number] {
  const m = ref?.match(/^([A-Z]+)(\d+)/);
  return m ? [m[1], parseInt(m[2], 10)] : ['~', 0];
}

/** One-line description for the report header. */
export function gridSummary(grids: (GridInfo | null | undefined)[], nSheets: number): string {
  const gs = grids.filter((g): g is GridInfo => !!g);
  if (!gs.length) return 'none detected';
  const g = gs[0];
  const rs = [...g.rows].sort(), cs = [...g.cols].sort((p, q) => colNum(p) - colNum(q));
  const conf = gs.every(x => x.confidence === 'high') ? 'high' : 'medium';
  return `Border zone on ${gs.length}/${nSheets} sheets, rows ${rs[0]}-${rs[rs.length - 1]}, columns ${cs[0]}-${cs[cs.length - 1]} (${conf} confidence)`;
}
