/// <reference lib="webworker" />
import { rgbaToGray, diffMask, regions, type Gray } from '../lib/raster';
import { diffShapes, type VecChange } from '../lib/vecdiff';
import type { Shape } from '../lib/vector';
import type { BBox } from '../lib/types';

export interface RasterJob {
  id: number;
  scale: number;
  a: { rgba: Uint8ClampedArray; w: number; h: number };
  b: { rgba: Uint8ClampedArray; w: number; h: number; offset: [number, number] }[]; // candidates (B rendered shifted)
  /** All word boxes (pt) on A and on B: text is diffed by the text layer, never reported as graphics. */
  textA?: BBox[]; textB?: BBox[];
  /** Painted paths from the operator lists (pt, page coordinates). */
  shapesA?: Shape[]; shapesB?: Shape[];
}

export interface RasterResult { id: number; offset: [number, number]; regions: ReturnType<typeof regions>; vec: VecChange[]; count: number }

type Mask = { mask: Uint8Array; w: number; h: number };
const toPx = (dm: Mask, b: BBox, scale: number, pad: number) => [
  Math.max(0, Math.floor((b[0] - pad) * scale)), Math.max(0, Math.floor((b[1] - pad) * scale)),
  Math.min(dm.w, Math.ceil((b[2] + pad) * scale)), Math.min(dm.h, Math.ceil((b[3] + pad) * scale)),
];

/** Clear mask pixels inside the (padded) boxes. */
function clearBoxes(dm: Mask, boxes: BBox[], scale: number, pad = 2) {
  for (const b of boxes) {
    const [x0, y0, x1, y1] = toPx(dm, b, scale, pad);
    for (let y = y0; y < y1; y++) dm.mask.fill(0, y * dm.w + x0, y * dm.w + Math.max(x0, x1));
  }
}

/**
 * Pixel evidence for a shape change: differing pixels inside the union of the old and new box but outside their
 * common core (the intersection shrunk by `pad`). Pixels in the core belong to whatever overlaps both versions
 * (e.g. a new leader line ending on the shape), not to the change itself. Each pixel is counted once.
 */
function evidence(dm: Mask, a: BBox, b: BBox, scale: number, pad: number, useCore = true): number {
  const core: BBox = [Math.max(a[0], b[0]) + pad, Math.max(a[1], b[1]) + pad, Math.min(a[2], b[2]) - pad, Math.min(a[3], b[3]) - pad];
  const hasCore = useCore && core[2] > core[0] && core[3] > core[1];
  const [cx0, cy0, cx1, cy1] = hasCore ? toPx(dm, core, scale, 0) : [0, 0, 0, 0];
  const seen = new Set<number>();
  let n = 0;
  for (const bb of [a, b]) {
    const [x0, y0, x1, y1] = toPx(dm, bb, scale, pad);
    for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
      if (hasCore && x >= cx0 && x < cx1 && y >= cy0 && y < cy1) continue;
      const k = y * dm.w + x;
      if (dm.mask[k] && !seen.has(k)) { seen.add(k); n++; }
    }
  }
  return n;
}

/** Moved shapes sharing one displacement (within 3 pt), at least 20 of them: whole views or symbol groups. */
function bigMoves(vec: VecChange[], offset: [number, number]) {
  const out: { d: [number, number]; cs: VecChange[]; box: BBox }[] = [];
  for (const c of vec) {
    if (c.op !== 'moved') continue;
    const d: [number, number] = [(c.b.bbox[0] + c.b.bbox[2]) / 2 - offset[0] - (c.a.bbox[0] + c.a.bbox[2]) / 2, (c.b.bbox[1] + c.b.bbox[3]) / 2 - offset[1] - (c.a.bbox[1] + c.a.bbox[3]) / 2];
    const g = out.find(q => Math.hypot(q.d[0] - d[0], q.d[1] - d[1]) <= 3);
    if (g) g.cs.push(c); else out.push({ d, cs: [c], box: c.a.bbox });
  }
  const med = (xs: number[]) => [...xs].sort((p, q) => p - q)[Math.floor(xs.length / 2)];
  return out.filter(g => g.cs.length >= 20).map(g => {
    const d: [number, number] = [med(g.cs.map(c => (c.b.bbox[0] + c.b.bbox[2] - c.a.bbox[0] - c.a.bbox[2]) / 2 - offset[0])), med(g.cs.map(c => (c.b.bbox[1] + c.b.bbox[3] - c.a.bbox[1] - c.a.bbox[3]) / 2 - offset[1]))];
    const bs = g.cs.flatMap(c => [c.a.bbox, [c.a.bbox[0] + d[0], c.a.bbox[1] + d[1], c.a.bbox[2] + d[0], c.a.bbox[3] + d[1]] as BBox]);
    return { d, cs: g.cs, box: [Math.min(...bs.map(b => b[0])), Math.min(...bs.map(b => b[1])), Math.max(...bs.map(b => b[2])), Math.max(...bs.map(b => b[3]))] as BBox };
  });
}

/** Inside `box` (pt, A frame): mask &= (A differs from B sampled at +d), with a 5x5 tolerance (the move
 *  is rounded to whole pixels and regenerated views jitter by a fraction of a point). */
function residualAfterMove(dm: Mask & { darkA: Uint8Array }, A: Gray, B: Gray, box: BBox, d: [number, number], scale: number, thr = 60) {
  const [x0, y0, x1, y1] = toPx(dm, box, scale, 4);
  const sx = Math.round(d[0] * scale), sy = Math.round(d[1] * scale);
  const at = (g: Gray, x: number, y: number) => (x < 0 || y < 0 || x >= g.w || y >= g.h ? 255 : g.data[y * g.w + x]);
  const mm = (g: Gray, x: number, y: number) => {
    let mn = 255, mx = 0;
    for (let v = -2; v <= 2; v++) for (let u = -2; u <= 2; u++) { const p = at(g, x + u, y + v); if (p < mn) mn = p; if (p > mx) mx = p; }
    return [mn, mx];
  };
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) {
    const k = y * dm.w + x;
    if (!dm.mask[k]) continue;
    const va = at(A, x, y), vb = at(B, x + sx, y + sy);
    const [bmn, bmx] = mm(B, x + sx, y + sy), [amn, amx] = mm(A, x, y);
    const diff = va < bmn - thr || va > bmx + thr || vb < amn - thr || vb > amx + thr;
    if (!diff) dm.mask[k] = 0;
    else dm.darkA[k] = va < vb ? 1 : 0;
  }
}

type Region = ReturnType<typeof regions>[number];
/**
 * Leftover regions inside a moved view: a regenerated view jitters edges by a point or two, so only clusters
 * (30 pt proximity) holding a real amount of ink (`minPix`, about 50 pt of stroke) that was clearly added or
 * clearly removed are kept, merged into one region.
 */
function residualInViews(regs: Region[], boxes: BBox[], minPix: number): Region[] {
  const inside = (r: Region) => boxes.some(b => { const x = (r.bbox[0] + r.bbox[2]) / 2, y = (r.bbox[1] + r.bbox[3]) / 2; return x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3]; });
  const out = regs.filter(r => !inside(r));
  const rest = regs.filter(inside);
  const near = (p: BBox, q: BBox) => p[0] <= q[2] + 30 && q[0] <= p[2] + 30 && p[1] <= q[3] + 30 && q[1] <= p[3] + 30;
  const clusters: Region[][] = [];
  for (const r of rest) {
    const hit = clusters.filter(c => c.some(q => near(q.bbox, r.bbox)));
    const merged = [r, ...hit.flat()];
    for (const h of hit) clusters.splice(clusters.indexOf(h), 1);
    clusters.push(merged);
  }
  for (const c of clusters) {
    const pixels = c.reduce((p, r) => p + r.pixels, 0);
    const dA = c.reduce((p, r) => p + r.darkA, 0), dB = c.reduce((p, r) => p + r.darkB, 0);
    if (pixels < minPix || (dA < 3 * dB && dB < 3 * dA)) continue; // jitter differs both ways; real edits are one-sided
    out.push({ bbox: [Math.min(...c.map(r => r.bbox[0])), Math.min(...c.map(r => r.bbox[1])), Math.max(...c.map(r => r.bbox[2])), Math.max(...c.map(r => r.bbox[3]))],
      pixels, darkA: c.reduce((p, r) => p + r.darkA, 0), darkB: c.reduce((p, r) => p + r.darkB, 0) });
  }
  return out;
}

self.onmessage = (e: MessageEvent<RasterJob>) => {
  const { id, scale, a, b } = e.data;
  const A = rgbaToGray(a.rgba, a.w, a.h);
  // pick the alignment candidate that leaves the fewest differing pixels (offset must clearly win over none)
  let best: { dm: ReturnType<typeof diffMask>; offset: [number, number]; B: Gray } | null = null;
  for (const c of b) {
    const Bg = rgbaToGray(c.rgba, c.w, c.h);
    const dm = diffMask(A, Bg);
    const isZero = c.offset[0] === 0 && c.offset[1] === 0;
    if (!best || (isZero ? dm.count < best.dm.count : dm.count < best.dm.count * 0.9)) best = { dm, offset: c.offset, B: Bg };
  }
  if (!best) { self.postMessage({ id, offset: [0, 0], regions: [], vec: [], count: 0 } satisfies RasterResult); return; }
  const [ox, oy] = best.offset; // B was rendered shifted by -offset, so B boxes map to bbox - offset in the image
  const inA = (bb: BBox): BBox => [bb[0] - ox, bb[1] - oy, bb[2] - ox, bb[3] - oy];
  // 1. text never counts as graphics
  clearBoxes(best.dm, [...(e.data.textA ?? []), ...(e.data.textB ?? []).map(inA)], scale);
  // noise floor: about 10 pt of 1 px stroke (≈3.5 mm); smaller specks are usually curve re-tessellation between exports
  const minPix = Math.max(6, Math.ceil(10 * scale));
  // 2. vector layer: keep only shape changes the pixels confirm (re-exported, re-tessellated paths often differ in
  //    the operator list but render the same)
  const vd = diffShapes(e.data.shapesA ?? [], e.data.shapesB ?? [], best.offset);
  const vec = vd.changes.filter(c => (c.op === 'modified'
    ? evidence(best!.dm, c.a.bbox, inA(c.b.bbox), scale, 1, false) // style change: the whole shape counts
    : evidence(best!.dm, c.a.bbox, inA(c.b.bbox), scale, 1 + Math.max(c.a.lw, c.b.lw) / 2)) >= minPix);
  // large coherent moves (a whole view shifted): compare the area again with B shifted back by the move, and keep
  // only pixels that differ under both alignments, so changes inside the moved view still show up
  const groups = bigMoves(vec, best.offset);
  const inGroup = new Set(groups.flatMap(g => g.cs));
  for (const g of groups) residualAfterMove(best.dm, A, best.B, g.box, g.d, scale);
  if (groups.length) clearBoxes(best.dm, [...(e.data.textA ?? []), ...(e.data.textB ?? []).map(inA)], scale);
  const small = vec.filter(c => !inGroup.has(c));
  clearBoxes(best.dm, small.flatMap(c => [c.a.bbox, inA(c.b.bbox)]), scale, 1 + Math.max(0, ...small.map(c => Math.max(c.a.lw, c.b.lw))) / 2);
  // 3. whatever is left: pixel regions (added/removed shapes, images, shadings)
  let regs = regions(best.dm, scale, 3, minPix);
  if (groups.length) regs = residualInViews(regs, groups.map(g => g.box), 5 * minPix);
  self.postMessage({ id, offset: best.offset, regions: regs, vec, count: best.dm.count } satisfies RasterResult);
};
