import type { BBox, Change, ChangeOp, Word } from './types';
import { myers, charRefine, type Op } from './myers';
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

/**
 * Word-level Myers diff in reading order, with character refinement for replaced spans.
 * Returns text changes with boxes on A (removed/modified) and B (added/modified).
 */
export function diffWords(wa: Word[], wb: Word[], pair: number, offset: [number, number] = [0, 0]): Change[] {
  const [ox, oy] = offset; // B-minus-A page shift, compensated when comparing positions
  const A = readingOrder(wa), B = readingOrder(wb);
  const ops = myers(A.map(w => w.text), B.map(w => w.text));
  // A word that Myers reports as deleted and re-inserted at the same spot only moved in reading order
  // (e.g. a neighbouring line changed height); treat those as unchanged.
  const same = new Set<Op>();
  const insByText = new Map<string, Op[]>();
  for (const o of ops) if (o.type === 'insert') insByText.set(B[o.bIndex].text, [...(insByText.get(B[o.bIndex].text) ?? []), o]);
  for (const o of ops) {
    if (o.type !== 'delete') continue;
    const wa0 = A[o.aIndex], cand = insByText.get(wa0.text) ?? [];
    const k = cand.findIndex(q => !same.has(q) && Math.hypot(cx(B[q.bIndex].bbox) - ox - cx(wa0.bbox), cy(B[q.bIndex].bbox) - oy - cy(wa0.bbox)) < 1.5);
    if (k >= 0) { same.add(o); same.add(cand[k]); }
  }
  const changes: Change[] = [];
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
        const hb0 = unionBox(h.map(w => w.bbox)) as BBox;
        const hb: BBox = [hb0[0] - ox, hb0[1] - oy, hb0[2] - ox, hb0[3] - oy];
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
    if (o.type === 'equal' || same.has(o)) flush();
    else if (o.type === 'delete') del.push(A[o.aIndex]);
    else ins.push(B[o.bIndex]);
  }
  flush();
  return mergeNearby(changes);
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
      if (x.kind !== c.kind || x.op !== c.op || x.op === 'modified') return false;
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

export function opLabel(op: ChangeOp) { return op === 'added' ? 'Added' : op === 'removed' ? 'Removed' : 'Modified'; }
