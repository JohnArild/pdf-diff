import { describe, expect, it } from 'vitest';
import { foldRepeated } from './folding';
import type { Change } from './types';

const rev = (pair: number, after = 'A'): Change => ({ id: `t${pair}${after}`, kind: 'text', op: 'modified', pair, bboxA: [520, 752, 525, 760], bboxB: [520, 752, 525, 760], before: '-', after, gridRef: null });

describe('foldRepeated', () => {
  it('folds a change repeated on every sheet into one row', () => {
    const cs = Array.from({ length: 26 }, (_, i) => rev(i));
    const note: Change = { id: 'n', kind: 'text', op: 'added', pair: 21, bboxA: null, bboxB: [1, 1, 9, 9], after: 'PAINT', gridRef: null };
    const { folded, rest } = foldRepeated([...cs, note], 26);
    expect(folded).toHaveLength(1);
    expect(folded[0]).toMatchObject({ kind: 'text', op: 'modified', before: '-', after: 'A' });
    expect(folded[0].pairs).toHaveLength(26);
    expect(rest).toEqual([note]);
    expect(cs.every(c => c.foldKey === folded[0].key)).toBe(true);
  });
  it('does not fold changes on fewer than half the sheets', () => {
    const cs = [0, 1, 2].map(i => rev(i));
    const { folded, rest } = foldRepeated(cs, 10);
    expect(folded).toHaveLength(0);
    expect(rest).toHaveLength(3);
  });
  it('needs at least two sheets and identical text', () => {
    expect(foldRepeated([rev(0)], 1).folded).toHaveLength(0);
    expect(foldRepeated([rev(0, 'A'), rev(1, 'B')], 2).folded).toHaveLength(0);
    expect(foldRepeated([rev(0), rev(1)], 2).folded).toHaveLength(1);
  });
});
