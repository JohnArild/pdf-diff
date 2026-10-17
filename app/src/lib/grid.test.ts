import { describe, expect, it } from 'vitest';
import { cellAt, detectGrid, gridRef, gridSummary } from './grid';
import type { Word } from './types';

/** Border labels on a W x H sheet: `cols` along top and bottom, `rows` along left and right (label centres at cell midpoints). */
function border(W: number, H: number, cols: string[], rows: string[], edges = { top: true, bottom: true, left: true, right: true }): Word[] {
  const out: Word[] = [];
  const lab = (t: string, x: number, y: number): Word => ({ text: t, bbox: [x - 3, y - 4, x + 3, y + 4] });
  cols.forEach((c, i) => {
    const x = ((i + 0.5) * W) / cols.length;
    if (edges.top) out.push(lab(c, x, 10));
    if (edges.bottom) out.push(lab(c, x, H - 10));
  });
  rows.forEach((r, i) => {
    const y = ((i + 0.5) * H) / rows.length;
    if (edges.left) out.push(lab(r, 10, y));
    if (edges.right) out.push(lab(r, W - 10, y));
  });
  // body text that must not be taken for labels
  out.push({ text: '3', bbox: [400, 400, 406, 408] }, { text: 'B', bbox: [500, 300, 506, 308] });
  return out;
}

describe('detectGrid', () => {
  it('reads ASME labels (8..1, D..A) and gives cells and ranges', () => {
    const W = 2448, H = 1584;
    const g = detectGrid(border(W, H, ['8', '7', '6', '5', '4', '3', '2', '1'], ['D', 'C', 'B', 'A']), W, H)!;
    expect(g.cols).toEqual(['8', '7', '6', '5', '4', '3', '2', '1']);
    expect(g.rows).toEqual(['D', 'C', 'B', 'A']);
    expect(g.confidence).toBe('high');
    expect(cellAt(g, 2300, 100)).toBe('D1');
    expect(cellAt(g, 345, 1027)).toBe('B7');
    expect(gridRef(g, [1837, 92, 2335, 120])).toBe('D1–D2');
    expect(gridRef(g, [93, 569, 927, 1117])).toBe('B5–C8');
    expect(gridSummary([g, g, null], 3)).toBe('Border zone on 2/3 sheets, rows A-D, columns 1-8 (high confidence)');
  });
  it('reads ISO labels (1..6, A..D) from one edge per axis with lower confidence', () => {
    const W = 1191, H = 842;
    const g = detectGrid(border(W, H, ['1', '2', '3', '4', '5', '6'], ['A', 'B', 'C', 'D'], { top: true, bottom: false, left: true, right: false }), W, H)!;
    expect(g.cols[0]).toBe('1');
    expect(g.rows[0]).toBe('A');
    expect(g.confidence).not.toBe('high');
    expect(cellAt(g, 50, 50)).toBe('A1');
  });
  it('finds no grid on a sheet without border labels', () => {
    expect(detectGrid([{ text: 'Hello', bbox: [100, 100, 140, 110] }], 595, 842)).toBeNull();
    expect(gridSummary([null], 1)).toBe('none detected');
  });
});
