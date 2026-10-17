import { describe, expect, it } from 'vitest';
import { formatReport, describe as describeChange } from './report';
import { foldRepeated } from './folding';
import type { Change, DiffResult, PagePair, SheetInfo } from './types';

function sample(): DiffResult {
  const n = 3;
  const pairs: PagePair[] = Array.from({ length: n }, (_, i) => ({ a: i, b: i, key: `s${i + 1}`, by: 'sheet', label: `Sheet ${i + 1}/${n}` }));
  const sheets: SheetInfo[] = pairs.map((_, i) => ({ sheet: `${i + 1}/${n}`, dwg: 'OHC0003', rev: 'A' }));
  const changes: Change[] = pairs.map((_, i) => ({ id: `r${i}`, kind: 'text', op: 'modified', pair: i, bboxA: [1, 1, 2, 2], bboxB: [1, 1, 2, 2], before: '-', after: 'A', gridRef: null }));
  changes.push({ id: 'n1', kind: 'text', op: 'added', pair: 2, bboxA: null, bboxB: [50, 500, 300, 510], after: 'PAINT INSIDE OF RING FED-STD-595, FS37875, INSIGNIA WHITE', gridRef: null });
  changes.push({ id: 'g1', kind: 'graphics', op: 'removed', pair: 2, bboxA: [72, 72, 144, 108], bboxB: null, gridRef: null });
  const { folded } = foldRepeated(changes, n);
  return {
    pairs, sheetsA: sheets, sheetsB: sheets, folded,
    perPair: pairs.map((_, i) => ({ pair: i, offset: [0, 0] as [number, number], changes: changes.filter(c => c.pair === i) })),
  };
}

describe('describe', () => {
  it('formats graphics regions in mm and clips long text', () => {
    const r = sample();
    const g = r.perPair[2].changes.find(c => c.kind === 'graphics')!;
    expect(describeChange(g)).toBe('Graphics (25x13 mm region)');
    const t = r.perPair[2].changes.find(c => c.op === 'added')!;
    expect(describeChange(t)).toBe('Text "PAINT INSIDE OF RING FED-STD-595, FS378..."');
  });
  it('drops shared leading words of a long modification so the difference stays visible', () => {
    const c: Change = { id: 'm', kind: 'text', op: 'modified', pair: 0, bboxA: [0, 0, 1, 1], bboxB: [0, 0, 1, 1], gridRef: null,
      before: 'ASSY, ABSIS HID BUS MASTER', after: 'ASSY, ABSIS BUS MASTER' };
    expect(describeChange(c)).toBe('Text "...HID BUS MASTER" -> "...BUS MASTER"');
    expect(describeChange({ ...c, before: 'ABSIS003', after: 'ABSIS011' })).toBe('Text "ABSIS003" -> "ABSIS011"');
  });
});

describe('formatReport', () => {
  const r = sample();
  const txt = formatReport(r, { nameA: 'old.pdf', nameB: 'new.pdf', pagesA: 3, pagesB: 3, revA: '-', revB: 'A', generated: new Date('2026-10-17T10:05:00Z'), timeZone: 'Europe/Oslo' });
  const lines = txt.split('\n');
  it('has the PLAN.md §6 header', () => {
    expect(lines[0]).toBe('PDF DIFF REPORT');
    expect(txt).toContain('Rev A      old.pdf                       Rev -   3 pages');
    expect(txt).toContain('Generated  2026-10-17 12:05 (Europe/Oslo)');
    expect(txt).toContain('Totals     5 changes: 1 added, 1 removed, 3 modified');
    expect(txt).toContain('Grid       none detected');
  });
  it('lists folded changes once and the rest per sheet', () => {
    expect(txt).toContain('All sheets   -       Modified  Text "-" -> "A" (3/3 sheets)');
    expect(txt).toContain('Sheet 3/3 OHC0003 (Rev A p.3 / Rev B p.3) - 2 changes');
    expect(txt).toMatch(/^Sheet 3\/3    -       Removed   Graphics \(25x13 mm region\)$/m);
    expect(txt).toMatch(/^Sheet 3\/3    -       Added     Text "PAINT INSIDE OF/m);
    expect(txt).toContain('No other changes on 2 sheet(s): 1/3, 2/3');
  });
  it('budgets long modifications to fit', () => {
    const c: Change = { id: 'm', kind: 'text', op: 'modified', pair: 0, bboxA: [0, 0, 1, 1], bboxB: [0, 0, 1, 1], before: 'X'.repeat(60), after: 'Y'.repeat(60), gridRef: null };
    expect(describeChange(c).length).toBeLessThanOrEqual(49);
    expect(describeChange({ ...c, before: '-', after: 'A' })).toBe('Text "-" -> "A"');
  });
  it('wraps a long list of unchanged sheets', () => {
    const big = sample();
    const extra = Array.from({ length: 30 }, (_, k) => k + 4);
    for (const k of extra) {
      big.pairs.push({ a: k - 1, b: k - 1, key: `s${k}`, by: 'sheet', label: `Sheet ${k}/33` });
      big.sheetsA.push({ sheet: `${k}/33`, dwg: null, rev: 'A' });
      big.perPair.push({ pair: big.pairs.length - 1, offset: [0, 0], changes: [] });
    }
    const t = formatReport(big, { nameA: 'a', nameB: 'b', pagesA: 33, pagesB: 33, generated: new Date(0), timeZone: 'UTC' });
    const tail = t.split('\n').filter(l => l.startsWith('No other') || l.startsWith('  '));
    expect(tail.length).toBeGreaterThan(1);
    expect(Math.max(...tail.map(l => l.length))).toBeLessThanOrEqual(72);
  });
  it('stays within 80 columns and ends with a newline', () => {
    expect(Math.max(...lines.map(l => l.length))).toBeLessThanOrEqual(80);
    expect(txt.endsWith('\n')).toBe(true);
  });
});

describe('describe moved / resized', () => {
  const base = { id: 'x', pair: 0, gridRef: null } as const;
  it('text moved', () => {
    expect(describeChange({ ...base, kind: 'text', op: 'moved', bboxA: [0, 0, 1, 1], bboxB: [0, 0, 1, 1], before: 'Hello', after: 'Hello', move: [120, -40] }))
      .toBe('Text "Hello" moved dx=+120.0 dy=-40.0 pt');
  });
  it('graphics resized and moved', () => {
    expect(describeChange({ ...base, kind: 'graphics', op: 'resized', bboxA: [0, 0, 100, 60], bboxB: [0, 0, 160, 90], sizeA: [100, 60], sizeB: [160, 90], scale: [1.6, 1.5], shape: 'Filled box' }))
      .toBe('Filled box 100x60 -> 160x90 pt (x1.60 x1.50)');
    expect(describeChange({ ...base, kind: 'graphics', op: 'moved', bboxA: [0, 0, 1, 1], bboxB: [0, 0, 1, 1], move: [200, 100], shape: 'Filled box' }))
      .toBe('Filled box moved dx=+200.0 dy=+100.0 pt');
  });
  it('lists moved/resized in the totals only when present', () => {
    const r = sample();
    r.perPair[0].changes.push({ ...base, id: 'mv', kind: 'text', op: 'moved', bboxA: [0, 0, 1, 1], bboxB: [5, 5, 6, 6], before: 'X', after: 'X', move: [5, 5] });
    const t = formatReport(r, { nameA: 'a', nameB: 'b', pagesA: 3, pagesB: 3, generated: new Date(0), timeZone: 'UTC' });
    expect(t).toContain('Totals     6 changes: 1 added, 1 removed, 3 modified, 1 moved');
    expect(t).toMatch(/^Sheet 1\/3    -       Moved     Text "X" moved dx=\+5\.0 dy=\+5\.0 pt$/m);
  });
});
