/// <reference lib="webworker" />
import { rgbaToGray, diffMask, regions } from '../lib/raster';
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

self.onmessage = (e: MessageEvent<RasterJob>) => {
  const { id, scale, a, b } = e.data;
  const A = rgbaToGray(a.rgba, a.w, a.h);
  // pick the alignment candidate that leaves the fewest differing pixels (offset must clearly win over none)
  let best: { dm: ReturnType<typeof diffMask>; offset: [number, number] } | null = null;
  for (const c of b) {
    const dm = diffMask(A, rgbaToGray(c.rgba, c.w, c.h));
    const isZero = c.offset[0] === 0 && c.offset[1] === 0;
    if (!best || (isZero ? dm.count < best.dm.count : dm.count < best.dm.count * 0.9)) best = { dm, offset: c.offset };
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
  clearBoxes(best.dm, vec.flatMap(c => [c.a.bbox, inA(c.b.bbox)]), scale, 1 + Math.max(0, ...vec.map(c => Math.max(c.a.lw, c.b.lw))) / 2);
  // 3. whatever is left: pixel regions (added/removed shapes, images, shadings)
  const regs = regions(best.dm, scale, 3, minPix);
  self.postMessage({ id, offset: best.offset, regions: regs, vec, count: best.dm.count } satisfies RasterResult);
};
