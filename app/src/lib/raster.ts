import type { BBox } from './types';

export interface Gray { data: Uint8Array; w: number; h: number }
export interface RasterRegion { bbox: BBox; pixels: number; darkA: number; darkB: number }

export function rgbaToGray(rgba: Uint8ClampedArray | Uint8Array, w: number, h: number): Gray {
  const g = new Uint8Array(w * h);
  for (let i = 0, j = 0; i < g.length; i++, j += 4) {
    const a = rgba[j + 3] / 255; // transparent = white background
    const v = 0.299 * rgba[j] + 0.587 * rgba[j + 1] + 0.114 * rgba[j + 2];
    g[i] = Math.round(v * a + 255 * (1 - a));
  }
  return { data: g, w, h };
}

function minMax3(src: Gray): { mn: Uint8Array; mx: Uint8Array } {
  const { data, w, h } = src;
  const mn = new Uint8Array(w * h), mx = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let lo = 255, hi = 0;
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy; if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx; if (xx < 0 || xx >= w) continue;
        const v = data[yy * w + xx]; if (v < lo) lo = v; if (v > hi) hi = v;
      }
    }
    mn[y * w + x] = lo; mx[y * w + x] = hi;
  }
  return { mn, mx };
}

function morph(m: Uint8Array, w: number, h: number, dilate: boolean): Uint8Array {
  const o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let v = dilate ? 0 : 1;
    for (let dy = -1; dy <= 1 && (dilate ? !v : v); dy++) {
      const yy = y + dy;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const s = yy < 0 || yy >= h || xx < 0 || xx >= w ? 0 : m[yy * w + xx];
        if (dilate && s) { v = 1; break; }
        if (!dilate && !s) { v = 0; break; }
      }
    }
    o[y * w + x] = v;
  }
  return o;
}

function dropIsolated(m: Uint8Array, w: number, h: number): Uint8Array {
  const o = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x; if (!m[i]) continue;
    let nb = 0;
    for (let dy = -1; dy <= 1 && !nb; dy++) {
      const yy = y + dy; if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx; if ((dx || dy) && xx >= 0 && xx < w && m[yy * w + xx]) { nb = 1; break; }
      }
    }
    o[i] = nb;
  }
  return o;
}

/** Tolerant pixel difference: a pixel differs only if no pixel in the other image's 3x3
 *  neighbourhood is within `thr` grey levels (absorbs anti-aliasing and 1 px shifts). */
export function diffMask(a: Gray, b: Gray, thr = 60): { mask: Uint8Array; w: number; h: number; count: number; darkA: Uint8Array } {
  const w = Math.min(a.w, b.w), h = Math.min(a.h, b.h);
  const crop = (g: Gray): Gray => {
    if (g.w === w && g.h === h) return g;
    const d = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) d.set(g.data.subarray(y * g.w, y * g.w + w), y * w);
    return { data: d, w, h };
  };
  const A = crop(a), B = crop(b);
  const ma = minMax3(A), mb = minMax3(B);
  let mask: Uint8Array = new Uint8Array(w * h);
  const darkA = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const va = A.data[i], vb = B.data[i];
    const d1 = va < mb.mn[i] - thr || va > mb.mx[i] + thr;
    const d2 = vb < ma.mn[i] - thr || vb > ma.mx[i] + thr;
    if (d1 || d2) { mask[i] = 1; darkA[i] = va < vb ? 1 : 0; }
  }
  mask = dropIsolated(mask, w, h); // removes speckle but keeps 1 px wide lines (an opening would erase them)
  let count = 0; for (let i = 0; i < mask.length; i++) count += mask[i];
  return { mask, w, h, count, darkA };
}

/** Cluster differing pixels into regions (dilate, then 4-connected components). bbox in points. */
export function regions(dm: { mask: Uint8Array; w: number; h: number; darkA: Uint8Array }, scale: number, grow = 3, minPixels = 6): RasterRegion[] {
  const { mask, w, h, darkA } = dm;
  let g = mask;
  for (let i = 0; i < grow; i++) g = morph(g, w, h, true);
  const lab = new Int32Array(w * h);
  const out: RasterRegion[] = [];
  const stack: number[] = [];
  let n = 0;
  for (let i = 0; i < w * h; i++) {
    if (!g[i] || lab[i]) continue;
    n++; lab[i] = n; stack.push(i);
    let x0 = w, y0 = h, x1 = 0, y1 = 0, px = 0, dA = 0, dB = 0;
    while (stack.length) {
      const k = stack.pop()!; const x = k % w, y = (k / w) | 0;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
      if (mask[k]) { px++; if (darkA[k]) dA++; else dB++; }
      const nb = [x > 0 ? k - 1 : -1, x < w - 1 ? k + 1 : -1, y > 0 ? k - w : -1, y < h - 1 ? k + w : -1];
      for (const q of nb) if (q >= 0 && g[q] && !lab[q]) { lab[q] = n; stack.push(q); }
    }
    if (px >= minPixels) out.push({ bbox: [x0 / scale, y0 / scale, (x1 + 1) / scale, (y1 + 1) / scale], pixels: px, darkA: dA, darkB: dB });
  }
  return out;
}
