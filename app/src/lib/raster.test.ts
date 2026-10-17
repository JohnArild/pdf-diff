import { describe, expect, it } from 'vitest';
import { diffMask, regions, type Gray } from './raster';

const blank = (w: number, h: number): Gray => ({ data: new Uint8Array(w * h).fill(255), w, h });
const box = (g: Gray, x0: number, y0: number, x1: number, y1: number) => { for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) g.data[y * g.w + x] = 0; return g; };

describe('raster diff', () => {
  it('finds no difference between identical images', () => {
    const a = box(blank(100, 100), 10, 10, 30, 30);
    expect(diffMask(a, box(blank(100, 100), 10, 10, 30, 30)).count).toBe(0);
  });
  it('tolerates a 1 px shift (antialiasing tolerance)', () => {
    const a = box(blank(100, 100), 10, 10, 30, 30), b = box(blank(100, 100), 11, 10, 31, 30);
    expect(diffMask(a, b).count).toBe(0);
  });
  it('locates an added shape and types it as dark on B', () => {
    const a = blank(200, 100), b = box(blank(200, 100), 120, 40, 160, 60);
    const rs = regions(diffMask(a, b), 1);
    expect(rs).toHaveLength(1);
    const r = rs[0];
    expect(r.darkB).toBeGreaterThan(r.darkA);
    expect(r.bbox[0]).toBeLessThanOrEqual(120);
    expect(r.bbox[2]).toBeGreaterThanOrEqual(159);
  });
  it('keeps a new 1 px wide line (e.g. a leader line) but drops isolated speckle', () => {
    const a = blank(200, 100), b = blank(200, 100);
    for (let x = 20; x < 120; x++) b.data[50 * 200 + x] = 0; // 1 px horizontal line
    b.data[10 * 200 + 180] = 0; // lone pixel
    const rs = regions(diffMask(a, b), 1);
    expect(rs).toHaveLength(1);
    expect(rs[0].bbox[2] - rs[0].bbox[0]).toBeGreaterThanOrEqual(99);
  });
  it('converts pixels to points using the render scale', () => {
    const a = box(blank(200, 100), 100, 40, 140, 60), b = blank(200, 100);
    const [r] = regions(diffMask(a, b), 2);
    expect(r.darkA).toBeGreaterThan(r.darkB);
    expect(r.bbox[0]).toBeLessThanOrEqual(50);
    expect(r.bbox[2]).toBeGreaterThanOrEqual(69);
  });
});
