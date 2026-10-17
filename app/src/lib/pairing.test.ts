import { describe, expect, it } from 'vitest';
import { pairPages, sheetInfo } from './pairing';
import { doc, line, page, titleBlock } from './testutil';

describe('sheetInfo', () => {
  it('reads sheet, drawing number and revision from the title block', () => {
    const s = sheetInfo(page(0, [...line('SOME NOTE', 50, 50), ...titleBlock(3, 26, 'A')]));
    expect(s).toEqual({ sheet: '3/26', dwg: 'OHC0003', rev: 'A' });
  });
  it('understands "n OF m"', () => {
    const s = sheetInfo(page(0, [...line('SHEET', 400, 770), ...line('2 OF 5', 440, 770)]));
    expect(s.sheet).toBe('2/5');
  });
  it('returns nulls for a page without a title block', () => {
    expect(sheetInfo(page(0, line('JUST TEXT HERE', 50, 50)))).toMatchObject({ sheet: null });
  });
});

describe('pairPages', () => {
  const mk = (sheets: number[], m: number) => doc('x', sheets.map((n, i) => page(i, titleBlock(n, m, 'A'))));
  it('pairs by sheet number even when the page order differs', () => {
    const a = mk([1, 2, 3], 3), b = mk([1, 3, 2], 3);
    const pairs = pairPages(a, b, a.pages.map(sheetInfo), b.pages.map(sheetInfo));
    expect(pairs.every(p => p.by === 'sheet')).toBe(true);
    expect(pairs.map(p => [p.a, p.b])).toEqual([[0, 0], [2, 1], [1, 2]]);
  });
  it('marks inserted and deleted sheets', () => {
    const a = mk([1, 2, 3], 3), b = mk([1, 3, 4], 4);
    // sheet totals differ, numbers 1 and 3 still match
    const pairs = pairPages(a, b, a.pages.map(sheetInfo), b.pages.map(sheetInfo));
    const byKey = Object.fromEntries(pairs.map(p => [p.key, [p.a, p.b]]));
    expect(pairs.find(p => p.a === 1)?.b ?? null).toBeNull(); // sheet 2 deleted
    expect(pairs.find(p => p.b === 2)?.a ?? null).toBeNull(); // sheet 4 inserted
    expect(Object.keys(byKey).length).toBe(4);
  });
  it('falls back to page order without sheet numbers', () => {
    const a = doc('a', [page(0, line('X', 1, 1)), page(1, line('Y', 1, 1))]);
    const b = doc('b', [page(0, line('X', 1, 1)), page(1, line('Y', 1, 1)), page(2, line('Z', 1, 1))]);
    const pairs = pairPages(a, b, a.pages.map(sheetInfo), b.pages.map(sheetInfo));
    expect(pairs.map(p => [p.a, p.b, p.by])).toEqual([[0, 0, 'order'], [1, 1, 'order'], [null, 2, 'order']]);
    expect(pairs[0].label).toBe('Page 1');
  });
});

describe('sheetInfo with a revision table', () => {
  it('takes REV from the title block, not from the revision history', () => {
    const ws = [...line('REV DESCRIPTION', 1828, 56), ...line('- INITIAL RELEASE', 1839, 74), ...line('A FN 21', 1839, 100), ...titleBlock(1, 26, 'A')];
    expect(sheetInfo(page(0, ws, 2448, 1584)).rev).toBe('A');
  });
});
