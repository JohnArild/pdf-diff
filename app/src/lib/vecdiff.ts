import type { BBox } from './types';
import type { Shape } from './vector';

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
export function diffShapes(sa: Shape[], sb0: Shape[], offset: [number, number] = [0, 0], tol = 1, maxPairing = 4000) {
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
  if (remA.length * remB.length <= maxPairing * maxPairing / 4) {
    // 2. style-only
    const styleC: { i: number; j: number; cost: number; v: null }[] = [];
    for (const i of remA) for (const j of remB)
      if (geomKey(sa[i]) === geomKey(sb[j]) && sameBox(sa[i].bbox, sb[j].bbox, tol) && styleKey(sa[i]) !== styleKey(sb[j])) styleC.push({ i, j, cost: 0, v: null });
    for (const p of assign(styleC, pA, pB)) {
      const a = sa[p.i], b = sb0[p.j], parts: string[] = [];
      if (a.fill !== b.fill) parts.push(`fill ${a.fill ?? 'none'} -> ${b.fill ?? 'none'}`);
      if (a.stroke !== b.stroke) parts.push(`stroke ${a.stroke ?? 'none'} -> ${b.stroke ?? 'none'}`);
      if (a.lw !== b.lw) parts.push(`width ${a.lw} -> ${b.lw} pt`);
      changes.push({ op: 'modified', a, b, detail: parts.join(', ') });
    }
    // 3. moved: same style and size elsewhere (nearest first)
    const moveC: { i: number; j: number; cost: number; v: null }[] = [];
    for (const i of remA) for (const j of remB) {
      const a = sa[i], b = sb[j];
      if (styleKey(a) !== styleKey(b) || a.n !== b.n || !sameSize(a.bbox, b.bbox, tol)) continue;
      moveC.push({ i, j, cost: Math.hypot(ccx(b.bbox) - ccx(a.bbox), ccy(b.bbox) - ccy(a.bbox)), v: null });
    }
    for (const p of assign(moveC, pA, pB)) changes.push({ op: 'moved', a: sa[p.i], b: sb0[p.j] });
    // 4. resized: same style and type, other size, overlapping or close (best overlap first)
    const resC: { i: number; j: number; cost: number; v: null }[] = [];
    for (const i of remA) for (const j of remB) {
      const a = sa[i], b = sb[j];
      if (styleKey(a) !== styleKey(b) || (a.type === 'path' && a.n !== b.n) || sameSize(a.bbox, b.bbox, tol) || !overlapOrNear(a.bbox, b.bbox)) continue;
      if (Math.min(w(a.bbox), h(a.bbox), w(b.bbox), h(b.bbox)) < 0.5 && a.type !== 'line') continue; // degenerate
      resC.push({ i, j, cost: Math.hypot(ccx(b.bbox) - ccx(a.bbox), ccy(b.bbox) - ccy(a.bbox)) / Math.max(1, w(a.bbox) + h(a.bbox)), v: null });
    }
    for (const p of assign(resC, pA, pB)) changes.push({ op: 'resized', a: sa[p.i], b: sb0[p.j] });
  }
  return {
    changes,
    removed: remA.filter(i => !pA.has(i)).map(i => sa[i]),
    added: remB.filter(j => !pB.has(j)).map(j => sb0[j]),
  };
}
