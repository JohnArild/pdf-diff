import type { Change, FoldedChange } from './types';

/** Key under which identical changes on different sheets are considered "the same change". */
export function foldKey(c: Change): string {
  if (c.kind === 'text') return `text|${c.op}|${c.before ?? ''}|${c.after ?? ''}`;
  const b = (c.bboxB ?? c.bboxA)!;
  return `graphics|${c.op}|${b.map(v => Math.round(v / 5)).join(',')}`;
}

/** Fold changes that occur on at least half of the paired sheets (and at least 2) into one row each. */
export function foldRepeated(changes: Change[], nPairs: number): { folded: FoldedChange[]; rest: Change[] } {
  const groups = new Map<string, Change[]>();
  for (const c of changes) { const k = foldKey(c); groups.set(k, [...(groups.get(k) ?? []), c]); }
  const threshold = Math.max(2, Math.ceil(nPairs / 2));
  const folded: FoldedChange[] = [];
  const foldedIds = new Set<string>();
  for (const [key, cs] of groups) {
    const pairs = [...new Set(cs.map(c => c.pair))];
    if (pairs.length >= threshold) {
      folded.push({ key, kind: cs[0].kind, op: cs[0].op, before: cs[0].before, after: cs[0].after, pairs: pairs.sort((a, b) => a - b), members: cs.map(c => c.id) });
      cs.forEach(c => { foldedIds.add(c.id); c.foldKey = key; });
    }
  }
  return { folded, rest: changes.filter(c => !foldedIds.has(c.id)) };
}
