import type { BBox } from './types';
import { sigClose, type Shape } from './vector';

export interface VecChange {
  op: 'moved' | 'resized' | 'modified';
  a: Shape;
  b: Shape;
  /** style-only change, e.g. "fill #000000 -> #e61a1a" */
  detail?: string;
}

const styleKey = (s: Shape) => `${s.type}|${s.paint}|${s.fill}|${s.stroke}|${s.lw}`;
const geomKey = (s: Shape) => `${s.type}|${s.paint}`;
const w = (b: BBox) => b[2] - b[0], h = (b: BBox) => b[3] - b[1];
const ccx = (b: BBox) => (b[0] + b[2]) / 2, ccy = (b: BBox) => (b[1] + b[3]) / 2;
const shift = (b: BBox, dx: number, dy: number): BBox => [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy];
const sameBox = (p: BBox, q: BBox, tol: number) => Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol && Math.abs(p[2] - q[2]) <= tol && Math.abs(p[3] - q[3]) <= tol;
const sameSize = (p: BBox, q: BBox, tol: number) => Math.abs(w(p) - w(q)) <= tol && Math.abs(h(p) - h(q)) <= tol;
const overlapOrNear = (p: BBox, q: BBox) => {
  const r = Math.max(w(p), h(p), w(q), h(q)) * 0.5;
  return !(p[2] + r < q[0] || q[2] + r < p[0] || p[3] + r < q[1] || q[3] + r < p[1]);
};

/** Greedy assignment of candidate pairs by ascending cost. */
function assign<T>(cands: { i: number; j: number; cost: number; v: T }[], usedA: Set<number>, usedB: Set<number>): { i: number; j: number; v: T }[] {
  const out: { i: number; j: number; v: T }[] = [];
  for (const c of cands.sort((p, q) => p.cost - q.cost)) {
    if (usedA.has(c.i) || usedB.has(c.j)) continue;
    usedA.add(c.i); usedB.add(c.j); out.push(c);
  }
  return out;
}

/**
 * Diff two shape lists (B already in A's frame after subtracting `offset`).
 * Identical shapes (same style, box within `tol`) cancel. The rest is paired: same geometry with another style ->
 * modified; same style and size at another place -> moved; same style and type, other size, overlapping or nearby
 * -> resized. Unpaired shapes are returned as removed/added (the raster diff reports those).
 */
export function diffShapes(sa: Shape[], sb0: Shape[], offset: [number, number] = [0, 0], tol = 1, maxPairing = 300) {
  const sb = sb0.map(s => ({ ...s, bbox: shift(s.bbox, -offset[0], -offset[1]) }));
  // 1. exact matches via a spatial hash of box centres
  const cell = 8, grid = new Map<string, number[]>();
  const keyOf = (k: string, x: number, y: number) => `${k}|${Math.floor(x / cell)}|${Math.floor(y / cell)}`;
  sb.forEach((s, j) => { const k = keyOf(styleKey(s), ccx(s.bbox), ccy(s.bbox)); grid.set(k, [...(grid.get(k) ?? []), j]); });
  const usedB = new Set<number>(), remA: number[] = [];
  sa.forEach((s, i) => {
    const sk = styleKey(s), x = ccx(s.bbox), y = ccy(s.bbox);
    for (const dx of [-cell, 0, cell]) for (const dy of [-cell, 0, cell]) {
      const j = (grid.get(keyOf(sk, x + dx, y + dy)) ?? []).find(q => !usedB.has(q) && sameBox(sb[q].bbox, s.bbox, tol));
      if (j !== undefined) { usedB.add(j); return; }
    }
    remA.push(i);
  });
  const remB = sb.map((_, j) => j).filter(j => !usedB.has(j));
  const changes: VecChange[] = [];
  const pA = new Set<number>(), pB = new Set<number>();
  /** moved/resized pairs with the size of the coherent cluster they belong to (for the churn filter below) */
  const meta = new Map<VecChange, { i: number; j: number; k: number }>();
  // candidate generation is bucketed (no all-pairs), so busy sheets with thousands of unmatched paths still pair
  const push = <K,>(m: Map<K, number[]>, k: K, v: number) => { const a = m.get(k); if (a) a.push(v); else m.set(k, [v]); };
  // 2. style-only: same geometry (spatial hash of the box centre), other style
  const byCentre = new Map<string, number[]>();
  for (const j of remB) push(byCentre, `${geomKey(sb[j])}|${Math.floor(ccx(sb[j].bbox) / cell)}|${Math.floor(ccy(sb[j].bbox) / cell)}`, j);
  const styleC: { i: number; j: number; cost: number; v: null }[] = [];
  for (const i of remA) {
    const a = sa[i];
    for (const dx of [-1, 0, 1]) for (const dy of [-1, 0, 1])
      for (const j of byCentre.get(`${geomKey(a)}|${Math.floor(ccx(a.bbox) / cell) + dx}|${Math.floor(ccy(a.bbox) / cell) + dy}`) ?? [])
        if (sameBox(a.bbox, sb[j].bbox, tol) && styleKey(a) !== styleKey(sb[j])) styleC.push({ i, j, cost: 0, v: null });
  }
  for (const p of assign(styleC, pA, pB)) {
    const a = sa[p.i], b = sb0[p.j], parts: string[] = [];
    if (a.fill !== b.fill) parts.push(`fill ${a.fill ?? 'none'} -> ${b.fill ?? 'none'}`);
    if (a.stroke !== b.stroke) parts.push(`stroke ${a.stroke ?? 'none'} -> ${b.stroke ?? 'none'}`);
    if (a.lw !== b.lw) parts.push(`width ${a.lw} -> ${b.lw} pt`);
    changes.push({ op: 'modified', a, b, detail: parts.join(', ') });
  }
  // 3. moved: same style, point count, size and outline elsewhere. Moves must be coherent: a displacement shared by
  //    several shapes (a view or symbol moved as a whole), or an unambiguous single copy (one candidate each way).
  //    Nearest-copy pairing alone pairs unrelated identical primitives across the sheet.
  const bySize = new Map<string, number[]>();
  const sizeKey = (s: Shape, dw = 0, dh = 0) => `${styleKey(s)}|${s.n}|${Math.round(w(s.bbox)) + dw}|${Math.round(h(s.bbox)) + dh}`;
  for (const j of remB) if (!pB.has(j)) push(bySize, sizeKey(sb[j]), j);
  const moveC: { i: number; j: number; d: [number, number] }[] = [];
  for (const i of remA) {
    if (pA.has(i)) continue;
    const a = sa[i];
    for (const dw of [-1, 0, 1]) for (const dh of [-1, 0, 1]) {
      const js = bySize.get(sizeKey(a, dw, dh)) ?? [];
      if (js.length > maxPairing) continue; // thousands of identical primitives: pairing would be guesswork
      for (const j of js) {
        const b = sb[j];
        if (!sameSize(a.bbox, b.bbox, tol) || !sigClose(a, b, Math.min(0.05, tol / Math.max(1, w(a.bbox), h(a.bbox)) * 2))) continue;
        moveC.push({ i, j, d: [ccx(b.bbox) - ccx(a.bbox), ccy(b.bbox) - ccy(a.bbox)] });
      }
    }
  }
  const bins = new Map<string, Set<number>>();
  const binOf = (d: [number, number]) => `${Math.round(d[0] / 2)}|${Math.round(d[1] / 2)}`;
  for (const c of moveC) { const k = binOf(c.d); if (!bins.has(k)) bins.set(k, new Set()); bins.get(k)!.add(c.i); }
  const strong = [...bins].filter(([, v]) => v.size >= 3).sort((p, q) => q[1].size - p[1].size);
  for (const [k] of strong) {
    const [bx, by] = k.split('|').map(Number);
    const inBin = moveC.filter(c => Math.abs(c.d[0] / 2 - bx) <= 1 && Math.abs(c.d[1] / 2 - by) <= 1)
      .map(c => ({ i: c.i, j: c.j, cost: Math.hypot(c.d[0] - bx * 2, c.d[1] - by * 2), v: null }));
    const got = assign(inBin, pA, pB);
    // keep only spatially coherent clusters of >= 3 shapes; scattered coincidences are released again
    const near = (p: BBox, q: BBox) => p[0] <= q[2] + 20 && q[0] <= p[2] + 20 && p[1] <= q[3] + 20 && q[1] <= p[3] + 20;
    const comp = got.map((_, k) => k);
    const find = (k: number): number => (comp[k] === k ? k : (comp[k] = find(comp[k])));
    const cell = new Map<string, number[]>();
    got.forEach((p, k) => { const b = sa[p.i].bbox; push(cell, `${Math.floor(b[0] / 64)}|${Math.floor(b[1] / 64)}`, k); });
    got.forEach((p, k) => {
      const b = sa[p.i].bbox;
      for (let gx = Math.floor((b[0] - 20) / 64); gx <= Math.floor((b[2] + 20) / 64); gx++)
        for (let gy = Math.floor((b[1] - 20) / 64); gy <= Math.floor((b[3] + 20) / 64); gy++)
          for (const m of cell.get(`${gx}|${gy}`) ?? []) if (m !== k && near(b, sa[got[m].i].bbox)) comp[find(m)] = find(k);
    });
    const size = new Map<number, number>();
    got.forEach((_, k) => size.set(find(k), (size.get(find(k)) ?? 0) + 1));
    got.forEach((p, k) => {
      if (size.get(find(k))! >= 3) { const c: VecChange = { op: 'moved', a: sa[p.i], b: sb0[p.j] }; changes.push(c); meta.set(c, { i: p.i, j: p.j, k: size.get(find(k))! }); }
      else { pA.delete(p.i); pB.delete(p.j); }
    });
  }
  const left = moveC.filter(c => !pA.has(c.i) && !pB.has(c.j));
  const nA = new Map<number, number>(), nB = new Map<number, number>();
  for (const c of left) { nA.set(c.i, (nA.get(c.i) ?? 0) + 1); nB.set(c.j, (nB.get(c.j) ?? 0) + 1); }
  for (const c of left) if (sa[c.i].type !== 'line' && nA.get(c.i) === 1 && nB.get(c.j) === 1 && !pA.has(c.i) && !pB.has(c.j)) {
    pA.add(c.i); pB.add(c.j);
    const ch: VecChange = { op: 'moved', a: sa[c.i], b: sb0[c.j] }; changes.push(ch); meta.set(ch, { i: c.i, j: c.j, k: 1 });
  }
  // 4. resized: same style and type, other size, overlapping or close (best overlap first); coarse spatial grid
  const G = 128, byCell = new Map<string, number[]>();
  const cellsOf = (b: BBox, r: number) => {
    const out: string[] = [];
    const x0 = Math.floor((b[0] - r) / G), x1 = Math.floor((b[2] + r) / G), y0 = Math.floor((b[1] - r) / G), y1 = Math.floor((b[3] + r) / G);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) return out; // page-sized shapes (frames) are not resize candidates
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(`${x}|${y}`);
    return out;
  };
  for (const j of remB) if (!pB.has(j)) for (const k of cellsOf(sb[j].bbox, 0)) push(byCell, `${styleKey(sb[j])}|${k}`, j);
  const resC: { i: number; j: number; cost: number; v: null }[] = [];
  for (const i of remA) {
    if (pA.has(i)) continue;
    const a = sa[i], seen = new Set<number>();
    for (const k of cellsOf(a.bbox, 0.5 * Math.max(w(a.bbox), h(a.bbox)))) for (const j of byCell.get(`${styleKey(a)}|${k}`) ?? []) {
      if (seen.has(j)) continue;
      seen.add(j);
      const b = sb[j];
      if ((a.type === 'path' && (a.n !== b.n || !sigClose(a, b, 0.03))) || sameSize(a.bbox, b.bbox, tol) || !overlapOrNear(a.bbox, b.bbox)) continue;
      const sx = w(b.bbox) / Math.max(w(a.bbox), 1e-6), sy = h(b.bbox) / Math.max(h(a.bbox), 1e-6);
      if ((w(a.bbox) > 1 && (sx < 0.25 || sx > 4)) || (h(a.bbox) > 1 && (sy < 0.25 || sy > 4))) continue; // not the same object
      if (Math.min(w(a.bbox), h(a.bbox), w(b.bbox), h(b.bbox)) < 0.5 && a.type !== 'line') continue; // degenerate
      if ((w(a.bbox) <= 1) !== (w(b.bbox) <= 1) || (h(a.bbox) <= 1) !== (h(b.bbox) <= 1)) continue; // orientation changed
      resC.push({ i, j, cost: Math.hypot(ccx(b.bbox) - ccx(a.bbox), ccy(b.bbox) - ccy(a.bbox)) / Math.max(1, w(a.bbox) + h(a.bbox)), v: null });
    }
  }
  for (const p of assign(resC, pA, pB)) { const c: VecChange = { op: 'resized', a: sa[p.i], b: sb0[p.j] }; changes.push(c); meta.set(c, { i: p.i, j: p.j, k: 1 }); }
  // 5. churn filter: a small move/resize next to unpaired added/removed geometry is a redrawn area, not a move
  //    (identical primitives of the old and the new part pair by coincidence). Release those pairs; the area
  //    then reports as added/removed/modified graphics. Large coherent groups (whole views) are kept.
  let kept = changes;
  for (let pass = 0; pass < 2; pass++) {
    const churn = new Map<string, BBox[]>();
    const addBox = (b: BBox) => { for (let gx = Math.floor(b[0] / 64); gx <= Math.floor(b[2] / 64) && gx - Math.floor(b[0] / 64) < 40; gx++) for (let gy = Math.floor(b[1] / 64); gy <= Math.floor(b[3] / 64) && gy - Math.floor(b[1] / 64) < 40; gy++) { const k = `${gx}|${gy}`; const a = churn.get(k); if (a) a.push(b); else churn.set(k, [b]); } };
    for (const i of remA) if (!pA.has(i)) addBox(sa[i].bbox);
    for (const j of remB) if (!pB.has(j)) addBox(sb[j].bbox);
    const touches = (b: BBox, seen: Set<BBox>) => {
      for (let gx = Math.floor((b[0] - 20) / 64); gx <= Math.floor((b[2] + 20) / 64); gx++) for (let gy = Math.floor((b[1] - 20) / 64); gy <= Math.floor((b[3] + 20) / 64); gy++)
        for (const q of churn.get(`${gx}|${gy}`) ?? []) if (b[0] <= q[2] + 20 && q[0] <= b[2] + 20 && b[1] <= q[3] + 20 && q[1] <= b[3] + 20) seen.add(q);
      return seen;
    };
    // a resize is released only among real churn (3+ unpaired shapes); one new line next to a grown table is normal
    const churned = (c: VecChange, m: { i: number; j: number }) => touches(sb[m.j].bbox, touches(sa[m.i].bbox, new Set())).size >= (c.op === 'resized' ? 3 : 1);
    const next: VecChange[] = [];
    for (const c of kept) {
      const m = meta.get(c);
      if (m && m.k < 20 && churned(c, m)) { pA.delete(m.i); pB.delete(m.j); continue; }
      next.push(c);
    }
    if (next.length === kept.length) break;
    kept = next;
  }
  return {
    changes: kept,
    removed: remA.filter(i => !pA.has(i)).map(i => sa[i]),
    added: remB.filter(j => !pB.has(j)).map(j => sb0[j]),
  };
}
