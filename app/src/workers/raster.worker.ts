/// <reference lib="webworker" />
import { rgbaToGray, diffMask, regions } from '../lib/raster';
import type { BBox } from '../lib/types';

export interface RasterJob {
  id: number;
  scale: number;
  a: { rgba: Uint8ClampedArray; w: number; h: number };
  b: { rgba: Uint8ClampedArray; w: number; h: number; offset: [number, number] }[]; // candidates (B rendered shifted)
  /** Text-change boxes (pt) on A and on B; their pixels are already reported as text changes. */
  textA?: BBox[]; textB?: BBox[];
}

/** Clear mask pixels inside the (padded) boxes so that only graphics remain, e.g. the leader line of a new note. */
function clearBoxes(dm: { mask: Uint8Array; w: number; h: number }, boxes: BBox[], scale: number, pad = 2) {
  for (const b of boxes) {
    const x0 = Math.max(0, Math.floor((b[0] - pad) * scale)), y0 = Math.max(0, Math.floor((b[1] - pad) * scale));
    const x1 = Math.min(dm.w, Math.ceil((b[2] + pad) * scale)), y1 = Math.min(dm.h, Math.ceil((b[3] + pad) * scale));
    for (let y = y0; y < y1; y++) dm.mask.fill(0, y * dm.w + x0, y * dm.w + Math.max(x0, x1));
  }
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
  if (best) {
    const [ox, oy] = best.offset; // B was rendered shifted by -offset, so B boxes map to bbox - offset in the image
    clearBoxes(best.dm, [...(e.data.textA ?? []), ...(e.data.textB ?? []).map(b => [b[0] - ox, b[1] - oy, b[2] - ox, b[3] - oy] as BBox)], scale);
  }
  // noise floor: a region needs about 10 pt of 1 px stroke (≈3.5 mm); smaller specks are usually curve
  // re-tessellation between exports, not edits
  const regs = best ? regions(best.dm, scale, 3, Math.max(6, Math.ceil(10 * scale))) : [];
  self.postMessage({ id, offset: best?.offset ?? [0, 0], regions: regs, count: best?.dm.count ?? 0 });
};
