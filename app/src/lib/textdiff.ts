import type { BBox, Change, ChangeOp, Word } from './types';
import { myers, charRefine } from './myers';
import { readingOrder, unionBox, boxesNear, cx, cy } from './words';

/** Global B-minus-A page offset estimated from words whose text is unique on both pages. */
export function estimateOffset(wa: Word[], wb: Word[]): { offset: [number, number]; inliers: number; n: number } {
  const uniq = (ws: Word[]) => {
    const m = new Map<string, Word[]>();
    for (const w of ws) if (w.text.length >= 2) m.set(w.text, [...(m.get(w.text) ?? []), w]);
    return new Map([...m].filter(([, v]) => v.length === 1).map(([k, v]) => [k, v[0]]));
  };
  const A = uniq(wa), B = uniq(wb);
  const d: [number, number][] = [];
  for (const [t, w] of A) { const v = B.get(t); if (v) d.push([cx(v.bbox) - cx(w.bbox), cy(v.bbox) - cy(w.bbox)]); }
  if (d.length < 5) return { offset: [0, 0], inliers: 0, n: d.length };
  const med = (xs: number[]) => { const s = [...xs].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
  const mx = med(d.map(p => p[0])), my = med(d.map(p => p[1]));
  const inl = d.filter(p => Math.hypot(p[0] - mx, p[1] - my) < 0.5).length / d.length;
  if (inl < 0.6 || Math.hypot(mx, my) < 0.25) return { offset: [0, 0], inliers: inl, n: d.length };
  return { offset: [mx, my], inliers: inl, n: d.length };
}

/** Split a run of words into spatial clusters (words of one edit that are far apart become separate changes). */
function clusters(ws: Word[], pad: number): Word[][] {
  const out: Word[][] = [];
  for (const w of ws) {
    const c = out.find(g => g.some(x => boxesNear(x.bbox, w.bbox, Math.max(pad, (w.bbox[3] - w.bbox[1]) * 1.5))));
    if (c) c.push(w); else out.push([w]);
  }
  return out;
}

const join = (ws: Word[]) => ws.map(w => w.text).join(' ');

let seq = 0;
export function newId(prefix: string) { return `${prefix}${++seq}`; }

/** Tolerance (pt) below which a matched word counts as "not moved" (after page alignment). */
export const MOVE_TOL = 1;

const shiftBox = (b: BBox, dx: number, dy: number): BBox => [b[0] + dx, b[1] + dy, b[2] + dx, b[3] + dy];

/**
 * Text diff of one page pair.
 * 1. Position anchoring: a word with the same text at the same place on both pages (within MOVE_TOL after the
 *    page offset) is unchanged. This is what makes isolated labels on drawings robust to reading-order noise.
 * 2. A word-level Myers diff in reading order over the remaining words. Equal pairs there are the same text at a
 *    different place: they become "moved" changes, grouped by common displacement. Delete/insert runs are split
 *    spatially; a deletion with an insertion at (nearly) the same place is "modified", with character refinement.
 * 3. Removed and added clusters with identical text are paired into "moved" as well.
 */
export function diffWords(wa: Word[], wb: Word[], pair: number, offset: [number, number] = [0, 0]): Change[] {
  const [ox, oy] = offset; // B-minus-A page shift, compensated when comparing positions
  const A = readingOrder(wa), B = readingOrder(wb);
  // 1. anchors
  const usedB = new Set<number>();
  const bByText = new Map<string, number[]>();
  B.forEach((w, j) => bByText.set(w.text, [...(bByText.get(w.text) ?? []), j]));
  const freeA: Word[] = [];
  for (const w of A) {
    const j = (bByText.get(w.text) ?? []).find(k => !usedB.has(k) &&
      Math.abs(cx(B[k].bbox) - ox - cx(w.bbox)) <= MOVE_TOL && Math.abs(cy(B[k].bbox) - oy - cy(w.bbox)) <= MOVE_TOL);
    if (j === undefined) freeA.push(w); else usedB.add(j);
  }
  const freeB = B.filter((_, j) => !usedB.has(j));
  // 2. Myers over the rest
  const ops = myers(freeA.map(w => w.text), freeB.map(w => w.text));
  const changes: Change[] = [];
  const moved: { a: Word; b: Word; d: [number, number] }[] = [];
  let del: Word[] = [], ins: Word[] = [];
  const flush = () => {
    if (!del.length && !ins.length) return;
    const cd = clusters(del, 12), ci = clusters(ins, 12);
    const usedI = new Set<number>();
    for (const g of cd) {
      const bb = unionBox(g.map(w => w.bbox)) as BBox;
      // pair with an insertion cluster at (nearly) the same place -> modified
      let best = -1, bestD = Infinity;
      ci.forEach((h, j) => {
        if (usedI.has(j)) return;
        const hb = shiftBox(unionBox(h.map(w => w.bbox)) as BBox, -ox, -oy);
        const dd = Math.hypot(cx(hb) - cx(bb), cy(hb) - cy(bb));
        if (boxesNear(bb, hb, 20) && dd < bestD) { best = j; bestD = dd; }
      });
      if (best >= 0) {
        usedI.add(best);
        const h = ci[best];
        const before = join(g), after = join(h);
        const r = charRefine(before, after);
        changes.push({ id: newId('t'), kind: 'text', op: 'modified', pair, bboxA: bb, bboxB: unionBox(h.map(w => w.bbox)),
          before, after, gridRef: null, ...(r.common > 0 && before.length > 8 ? { detail: `${r.before || '∅'} → ${r.after || '∅'}` } : {}) });
      } else {
        changes.push({ id: newId('t'), kind: 'text', op: 'removed', pair, bboxA: bb, bboxB: null, before: join(g), gridRef: null });
      }
    }
    ci.forEach((h, j) => {
      if (usedI.has(j)) return;
      changes.push({ id: newId('t'), kind: 'text', op: 'added', pair, bboxA: null, bboxB: unionBox(h.map(w => w.bbox)), after: join(h), gridRef: null });
    });
    del = []; ins = [];
  };
  for (const o of ops) {
    if (o.type === 'equal') {
      flush();
      const a = freeA[o.aIndex], b = freeB[o.bIndex];
      moved.push({ a, b, d: [cx(b.bbox) - ox - cx(a.bbox), cy(b.bbox) - oy - cy(a.bbox)] });
    } else if (o.type === 'delete') del.push(freeA[o.aIndex]);
    else ins.push(freeB[o.bIndex]);
  }
  flush();
  const merged = mergeNearby(changes);
  return [...pairMovedClusters(merged, ox, oy), ...groupMoves(moved, pair, ox, oy)];
}

function movedChange(pair: number, text: string, bboxA: BBox, bboxB: BBox, ox: number, oy: number): Change {
  return { id: newId('t'), kind: 'text', op: 'moved', pair, bboxA, bboxB, before: text, after: text, gridRef: null,
    move: [round1(bboxB[0] - ox - bboxA[0]), round1(bboxB[1] - oy - bboxA[1])] };
}
const round1 = (v: number) => Math.round(v * 10) / 10;

/** Words that moved by a common displacement and sit together become one "Text moved" change. */
function groupMoves(ms: { a: Word; b: Word; d: [number, number] }[], pair: number, ox: number, oy: number): Change[] {
  const groups: (typeof ms)[] = [];
  for (const m of ms) {
    const h = Math.max(2, m.a.bbox[3] - m.a.bbox[1]);
    const g = groups.find(gr => gr.some(x => Math.hypot(x.d[0] - m.d[0], x.d[1] - m.d[1]) <= 2 && boxesNear(x.a.bbox, m.a.bbox, 1.5 * h)));
    if (g) g.push(m); else groups.push([m]);
  }
  return groups.map(g => movedChange(pair, g.map(m => m.a.text).join(' '), unionBox(g.map(m => m.a.bbox))!, unionBox(g.map(m => m.b.bbox))!, ox, oy));
}

/** A removed and an added change with identical text are a move. */
function pairMovedClusters(cs: Change[], ox: number, oy: number): Change[] {
  const out: Change[] = [];
  const used = new Set<Change>();
  for (const r of cs) {
    if (r.op !== 'removed' || used.has(r)) continue;
    const a = cs.find(x => x.op === 'added' && !used.has(x) && x.after === r.before);
    if (!a) continue;
    used.add(r); used.add(a);
    out.push(movedChange(r.pair, r.before!, r.bboxA!, a.bboxB!, ox, oy));
  }
  return [...cs.filter(c => !used.has(c)), ...out];
}

/** Two boxes side by side on one row (vertical overlap ≥ half the smaller height, small horizontal gap). */
function sameRow(a: BBox, b: BBox): boolean {
  const h = Math.min(a[3] - a[1], b[3] - b[1]);
  const vo = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
  const gap = Math.max(a[0], b[0]) - Math.min(a[2], b[2]);
  return vo >= 0.5 * h && gap < Math.max(30, 4 * h);
}

/**
 * Merge same-op changes that belong together: touching boxes (a two-line note) or cells of one table row
 * (e.g. REV | DESCRIPTION | DATE | APPROVED in a revision history).
 */
export function mergeNearby(changes: Change[], pad = 6): Change[] {
  // repeat until stable: a merge can make a box reach a neighbour that was visited earlier
  let cur = changes;
  for (let i = 0; i < 8; i++) { const next = mergeOnce(cur, pad); if (next.length === cur.length) return next; cur = next; }
  return cur;
}

function mergeOnce(changes: Change[], pad: number): Change[] {
  const out: Change[] = [];
  const box = (c: Change) => (c.bboxB ?? c.bboxA) as BBox;
  for (const c of changes) {
    let row = false;
    const o = out.find(x => {
      if (x.kind !== c.kind || x.op !== c.op || (x.op !== 'added' && x.op !== 'removed')) return false;
      if (boxesNear(box(x), box(c), pad)) { row = false; return true; }
      if (x.kind === 'text' && sameRow(box(x), box(c))) { row = true; return true; }
      return false;
    });
    if (!o) { out.push({ ...c }); continue; }
    // order of the merged text: left to right for row cells, else top to bottom
    const order = (x: Change) => { const b = box(x); return row ? b[0] : b[1] * 10000 + b[0]; };
    const [p, q] = order(o) <= order(c) ? [o, c] : [c, o];
    const before = [p.before, q.before].filter(Boolean).join(' '), after = [p.after, q.after].filter(Boolean).join(' ');
    if (c.bboxA) o.bboxA = o.bboxA ? unionBox([o.bboxA, c.bboxA]) : c.bboxA;
    if (c.bboxB) o.bboxB = o.bboxB ? unionBox([o.bboxB, c.bboxB]) : c.bboxB;
    if (o.before !== undefined || c.before !== undefined) o.before = before;
    if (o.after !== undefined || c.after !== undefined) o.after = after;
  }
  return out;
}

export function opLabel(op: ChangeOp) { return ({ added: 'Added', removed: 'Removed', modified: 'Modified', moved: 'Moved', resized: 'Resized' } as const)[op]; }
