import { describe, expect, it } from 'vitest';
import { charRefine, myers } from './myers';

const apply = (a: string[], b: string[]) => {
  const ops = myers(a, b);
  const outB: string[] = [];
  for (const o of ops) if (o.type !== 'delete') outB.push(o.type === 'equal' ? a[o.aIndex] : b[o.bIndex]);
  return { ops, outB };
};

describe('myers', () => {
  it('returns all-equal for identical input', () => {
    const { ops } = apply(['a', 'b', 'c'], ['a', 'b', 'c']);
    expect(ops.every(o => o.type === 'equal')).toBe(true);
  });
  it('finds a minimal edit script', () => {
    const a = 'A B C A B B A'.split(' '), b = 'C B A B A C'.split(' ');
    const { ops, outB } = apply(a, b);
    expect(outB).toEqual(b);
    expect(ops.filter(o => o.type !== 'equal').length).toBe(5); // classic Myers example: D = 5
  });
  it('handles empty sides', () => {
    expect(myers([], ['x', 'y']).map(o => o.type)).toEqual(['insert', 'insert']);
    expect(myers(['x'], []).map(o => o.type)).toEqual(['delete']);
    expect(myers([], [])).toEqual([]);
  });
  it('uses the custom equality', () => {
    const ops = myers(['A'], ['a'], (x, y) => x.toLowerCase() === y.toLowerCase());
    expect(ops.map(o => o.type)).toEqual(['equal']);
  });
});

describe('charRefine', () => {
  it('strips the common prefix and suffix', () => {
    expect(charRefine('FS37875', 'FS37886')).toMatchObject({ before: '75', after: '86' });
    expect(charRefine('REV -', 'REV A')).toMatchObject({ before: '-', after: 'A' });
  });
});
