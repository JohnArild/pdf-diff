import { describe, expect, it } from 'vitest';
import { diffWords, estimateOffset } from './textdiff';
import { line } from './testutil';

describe('diffWords', () => {
  it('reports nothing for identical pages', () => {
    const w = [...line('GENERAL NOTES', 50, 50), ...line('1. ALL DIMENSIONS IN MM', 50, 70)];
    expect(diffWords(w, w.map(x => ({ ...x })), 0)).toEqual([]);
  });
  it('detects an added note', () => {
    const a = [...line('GENERAL NOTES', 50, 50), ...line('1. ALL DIMENSIONS IN MM', 50, 70)];
    const b = [...a, ...line('2. PAINT INSIDE OF RING WHITE', 50, 200)];
    const cs = diffWords(a, b, 3);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ kind: 'text', op: 'added', pair: 3, bboxA: null, gridRef: null });
    expect(cs[0].after).toBe('2. PAINT INSIDE OF RING WHITE');
  });
  it('detects a removed word', () => {
    const a = [...line('KEEP', 50, 50), ...line('OBSOLETE CALLOUT', 300, 400)];
    const b = line('KEEP', 50, 50);
    const cs = diffWords(a, b, 0);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ op: 'removed', before: 'OBSOLETE CALLOUT', bboxB: null });
  });
  it('pairs a replacement in place into a modification', () => {
    const a = [...line('REV', 520, 740), ...line('-', 522, 752)];
    const b = [...line('REV', 520, 740), ...line('A', 522, 752)];
    const cs = diffWords(a, b, 0);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ op: 'modified', before: '-', after: 'A' });
    expect(cs[0].bboxA).not.toBeNull();
    expect(cs[0].bboxB).not.toBeNull();
  });
  it('keeps distant edits as separate changes', () => {
    const a = [...line('ALPHA', 50, 50), ...line('BETA', 400, 600)];
    const b = [...line('ALPHA2', 50, 50), ...line('BETA', 400, 600), ...line('GAMMA', 50, 700)];
    const ops = diffWords(a, b, 0).map(c => c.op).sort();
    expect(ops).toEqual(['added', 'modified']);
  });
});

describe('estimateOffset', () => {
  it('recovers a uniform page shift', () => {
    const a = line('ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT', 40, 100);
    const b = a.map(w => ({ text: w.text, bbox: [w.bbox[0] + 7, w.bbox[1] - 3, w.bbox[2] + 7, w.bbox[3] - 3] as [number, number, number, number] }));
    const r = estimateOffset(a, b);
    expect(r.offset[0]).toBeCloseTo(7, 1);
    expect(r.offset[1]).toBeCloseTo(-3, 1);
  });
  it('returns zero for unshifted pages', () => {
    const a = line('ONE TWO THREE FOUR FIVE SIX SEVEN EIGHT', 40, 100);
    expect(estimateOffset(a, a).offset).toEqual([0, 0]);
  });
});

describe('diffWords robustness', () => {
  it('ignores words that only moved in reading order', () => {
    const a = [{ text: '2', bbox: [100, 90, 110, 114] as [number, number, number, number] }, ...line('NOTE ONE', 50, 100)];
    // same words, but B's note sits slightly higher, so reading order changes
    const b = [{ text: '2', bbox: [100, 90, 110, 114] as [number, number, number, number] }, ...line('NOTE ONE', 50, 100)];
    b.reverse();
    expect(diffWords(a, b, 0)).toEqual([]);
  });
  it('merges the cells of an added table row into one change', () => {
    const a = line('REV DESCRIPTION DATE', 1828, 56);
    // real word boxes of the OHC0003 rev A revision-history row (pt, top-left origin)
    const W = (text: string, x0: number, y0: number, x1: number, y1: number) => ({ text, bbox: [x0, y0, x1, y1] as [number, number, number, number] });
    const b = [...a, W('A', 1837, 100, 1845, 113), W('FN', 1867, 93, 1880, 105), W('21:', 1887, 93, 1907, 105), W('EXTENDED', 1914, 93, 1967, 105),
      W('INDICA', 1974, 93, 2014, 105), W('TO', 2021, 93, 2035, 105), W('RING;', 2041, 93, 2075, 105), W('PAINTED', 2082, 93, 2129, 105), W('RING', 2135, 93, 2162, 105), W('WHITE.', 1867, 108, 1910, 120),
      W('7/27/2024', 2183, 100, 2237, 113), W('J.', 2276, 100, 2290, 113), W('STEENSEN', 2297, 100, 2354, 113)];
    const cs = diffWords(a, b, 0);
    expect(cs).toHaveLength(1);
    expect(cs[0].after).toBe('A FN 21: EXTENDED INDICA TO RING; PAINTED RING WHITE. 7/27/2024 J. STEENSEN');
  });
});

describe('diffWords with a page offset', () => {
  it('pairs a shifted replacement as a modification', () => {
    const a = [...line('ONE TWO THREE FOUR FIVE SIX', 40, 100), ...line('OLD', 300, 300)];
    const b = [...line('ONE TWO THREE FOUR FIVE SIX', 70, 130), ...line('NEW', 330, 330)];
    const cs = diffWords(a, b, 0, [30, 30]);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ op: 'modified', before: 'OLD', after: 'NEW' });
  });
});

describe('text moves', () => {
  it('reports a moved word as "moved" with its displacement', () => {
    const a = [...line('TITLE', 50, 50), ...line('Hello', 100, 106)];
    const b = [...line('TITLE', 50, 50), ...line('Hello', 220, 146)];
    const cs = diffWords(a, b, 0);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ kind: 'text', op: 'moved', before: 'Hello', after: 'Hello', move: [120, 40] });
  });
  it('ignores sub-tolerance jitter and compensates the page offset', () => {
    const a = line('Hello World', 100, 100);
    expect(diffWords(a, a.map(w => ({ ...w, bbox: [w.bbox[0] + 0.6, w.bbox[1], w.bbox[2] + 0.6, w.bbox[3]] as [number, number, number, number] })), 0)).toEqual([]);
    expect(diffWords(a, line('Hello World', 130, 110), 0, [30, 10])).toEqual([]);
  });
  it('groups words moved together into one change', () => {
    const a = [...line('NOTE 1: PAINT WHITE', 50, 400), ...line('FIXED', 50, 50)];
    const b = [...line('NOTE 1: PAINT WHITE', 300, 600), ...line('FIXED', 50, 50)];
    const cs = diffWords(a, b, 0);
    expect(cs).toHaveLength(1);
    expect(cs[0]).toMatchObject({ op: 'moved', before: 'NOTE 1: PAINT WHITE', move: [250, 200] });
  });
  it('pairs a removed and an added block with the same text across reading order', () => {
    // the block jumps from the top to the bottom, past other text, so Myers sees delete + insert
    const a = [...line('MOVING BLOCK', 50, 50), ...line('ALPHA BETA GAMMA', 50, 300)];
    const b = [...line('ALPHA BETA GAMMA', 50, 300), ...line('MOVING BLOCK', 50, 600)];
    const cs = diffWords(a, b, 0);
    expect(cs.map(c => c.op)).toEqual(['moved']);
    expect(cs[0].move).toEqual([0, 550]);
  });
});
