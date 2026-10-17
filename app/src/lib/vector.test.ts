import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { extractShapes, type OpsTable, type Shape } from './vector';
import { diffShapes } from './vecdiff';
import { vectorChanges } from './engine-core';

const FIX = path.resolve(__dirname, '../../e2e/fixtures');
async function shapes(file: string): Promise<Shape[]> {
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path.join(FIX, file))), verbosity: 0 }).promise;
  const page = await pdf.getPage(1);
  const ol = await page.getOperatorList();
  return extractShapes(ol.fnArray, ol.argsArray, pdfjs.OPS as unknown as OpsTable, page.getViewport({ scale: 1 }).transform);
}
const box = (s: Shape[]) => s.filter(x => x.paint === 'fill');
const r = (b: number[]) => b.map(v => Math.round(v));

describe('extractShapes (pdf.js operator list)', () => {
  it('reads a `re` box in top-left page coordinates', async () => {
    const s = await shapes('box_resize_corner_a.pdf');
    const f = box(s);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ type: 'rect', paint: 'fill', fill: '#000000' });
    expect(r(f[0].bbox)).toEqual([100, 792 - 460, 200, 792 - 400]);
    // the page border is a stroked rect
    expect(s.find(x => x.paint === 'stroke')).toMatchObject({ type: 'rect', lw: 0.5 });
  });
  it('recognises an m/l/h path box and a cm-placed box as rects', async () => {
    for (const f of ['box_resize_path_b.pdf', 'box_resize_cm_b.pdf']) {
      const b = box(await shapes(f));
      expect(b[0].type).toBe('rect');
      expect(r(b[0].bbox)).toEqual([100, 792 - 490, 260, 792 - 400]);
    }
  });
  it('reads fill colours', async () => {
    expect(box(await shapes('box_color_b.pdf'))[0].fill).toBe('#e61a1a');
  });
});

describe('diffShapes', () => {
  const pairOf = async (name: string) => diffShapes(await shapes(`${name}_a.pdf`), await shapes(`${name}_b.pdf`));
  it('cancels identical shapes (self vs self)', async () => {
    const s = await shapes('combo_a.pdf');
    expect(diffShapes(s, s.map(x => ({ ...x })))).toMatchObject({ changes: [], removed: [], added: [] });
  });
  for (const name of ['box_resize_corner', 'box_resize_center', 'box_resize_path', 'box_resize_cm']) {
    it(`pairs a resized box (${name})`, async () => {
      const d = await pairOf(name);
      expect(d.changes).toHaveLength(1);
      expect(d.changes[0].op).toBe('resized');
      const [c] = vectorChanges(d.changes, 0, [0, 0]);
      expect(c).toMatchObject({ op: 'resized', sizeA: [100, 60], sizeB: [160, 90], scale: [1.6, 1.5], shape: 'Filled box' });
      expect(d.removed).toEqual([]);
      expect(d.added).toEqual([]);
    });
  }
  it('pairs a moved box', async () => {
    const d = await pairOf('box_move');
    expect(d.changes.map(c => c.op)).toEqual(['moved']);
    expect(vectorChanges(d.changes, 0, [0, 0])[0].move).toEqual([200, 100]);
  });
  it('reports a colour change as modified', async () => {
    const d = await pairOf('box_color');
    expect(d.changes.map(c => c.op)).toEqual(['modified']);
    expect(d.changes[0].detail).toBe('fill #000000 -> #e61a1a');
  });
  it('handles the combination page', async () => {
    const d = await pairOf('combo');
    expect(d.changes.map(c => c.op).sort()).toEqual(['moved', 'resized']);
    expect(d.added).toHaveLength(1); // the new 50x50 box is left to the raster layer as "added"
    expect(r(d.added[0].bbox)).toEqual([100, 792 - 500, 150, 792 - 450]);
  });
  it('compensates the page offset', () => {
    const a: Shape = { bbox: [10, 10, 50, 30], type: 'rect', paint: 'fill', fill: '#000000', stroke: null, lw: 0, n: 4 };
    const b: Shape = { ...a, bbox: [15, 13, 55, 33] };
    expect(diffShapes([a], [b], [5, 3]).changes).toEqual([]);
  });
});
