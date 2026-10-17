import { describe, expect, it } from 'vitest';
import { diffShapes } from './vecdiff';
import type { Shape } from './vector';
import type { BBox } from './types';

const line = (b: BBox): Shape => ({ bbox: b, type: 'line', paint: 'stroke', fill: null, stroke: '#000000', lw: 0.5, n: 2, sig: [0, 0, 1, 1] });
const box = (b: BBox): Shape => ({ bbox: b, type: 'rect', paint: 'stroke', fill: null, stroke: '#000000', lw: 0.5, n: 4 });

describe('diffShapes move coherence', () => {
  it('moves a whole group by its shared displacement', () => {
    const a = Array.from({ length: 30 }, (_, k) => box([100 + 12 * k, 100, 110 + 12 * k, 108 + (k % 5)]));
    const b = a.map(s => ({ ...s, bbox: [s.bbox[0], s.bbox[1] - 15, s.bbox[2], s.bbox[3] - 15] as BBox }));
    const d = diffShapes(a, b);
    expect(d.changes.filter(c => c.op === 'moved')).toHaveLength(30);
    expect(d.added).toHaveLength(0);
  });
  it('does not pair scattered identical lines across the sheet as moves', () => {
    const a = [line([100, 100, 110, 106]), line([900, 400, 910, 406])];
    const b = [line([500, 1200, 510, 1206]), line([1800, 50, 1810, 56])];
    const d = diffShapes(a, b);
    expect(d.changes).toHaveLength(0);
    expect(d.removed).toHaveLength(2);
    expect(d.added).toHaveLength(2);
  });
  it('releases a small move inside a redrawn area (unpaired shapes around it)', () => {
    const a = [box([100, 100, 120, 110]), line([95, 95, 130, 96]), line([95, 115, 130, 116]), line([95, 95, 96, 116])];
    const b = [box([104, 103, 124, 113]), line([90, 90, 140, 140]), line([92, 120, 150, 121])];
    const d = diffShapes(a, b);
    expect(d.changes.filter(c => c.op === 'moved')).toHaveLength(0);
  });
});
