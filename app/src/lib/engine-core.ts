/** Pure, worker-safe parts of the comparison pipeline. */
import type { VecChange } from './vecdiff';
import { shapeName } from './vector';
import { boxesNear, unionBox } from './words';
import type { BBox, Change, DiffResult, DocData, PairResult } from './types';
import { sheetInfo, pairPages } from './pairing';
import { diffWords, estimateOffset, newId } from './textdiff';
import { foldRepeated } from './folding';
import { cellAt, detectGrid, gridRef } from './grid';
import type { RasterRegion } from './raster';

export interface TextStageResult extends Omit<DiffResult, 'folded'> {
  offsetCandidates: [number, number][];
}

export function textStage(a: DocData, b: DocData): TextStageResult {
  const sheetsA = a.pages.map(sheetInfo), sheetsB = b.pages.map(sheetInfo);
  const pairs = pairPages(a, b, sheetsA, sheetsB);
  const perPair: PairResult[] = [];
  const offsetCandidates: [number, number][] = [];
  pairs.forEach((p, i) => {
    if (p.a === null || p.b === null) {
      const only = p.a === null ? b.pages[p.b!] : a.pages[p.a];
      perPair.push({ pair: i, offset: [0, 0], grid: detectGrid(only.words, only.width, only.height), changes: [{ id: newId('p'), kind: 'page', op: p.a === null ? 'added' : 'removed', pair: i, bboxA: null, bboxB: null, gridRef: null }] });
      offsetCandidates.push([0, 0]);
      return;
    }
    const wa = a.pages[p.a].words, wb = b.pages[p.b].words;
    const off = estimateOffset(wa, wb).offset;
    offsetCandidates.push(off);
    const pb = b.pages[p.b], pa = a.pages[p.a];
    const grid = detectGrid(wb, pb.width, pb.height) ?? detectGrid(wa, pa.width, pa.height);
    perPair.push({ pair: i, offset: [0, 0], changes: diffWords(wa, wb, i, off), grid });
  });
  return { pairs, sheetsA, sheetsB, perPair, offsetCandidates };
}

/** Fraction of box `r` that lies inside box `t` grown by `pad`. */
function insideFrac(r: BBox, t: BBox, pad: number): number {
  const w = Math.max(0, Math.min(r[2], t[2] + pad) - Math.max(r[0], t[0] - pad)), h = Math.max(0, Math.min(r[3], t[3] + pad) - Math.max(r[1], t[1] - pad));
  const area = Math.max(1e-6, (r[2] - r[0]) * (r[3] - r[1]));
  return (w * h) / area;
}

/** Graphics changes from raster regions that are not already explained by a text change. */
export function graphicsChanges(regs: RasterRegion[], text: Change[], pair: number, offset: [number, number]): Change[] {
  const out: Change[] = [];
  const pad = 3;
  for (const r of regs) {
    // text pixels are cleared in the raster worker; drop leftovers that still lie (almost) inside a text change
    const bB0: BBox = [r.bbox[0] + offset[0], r.bbox[1] + offset[1], r.bbox[2] + offset[0], r.bbox[3] + offset[1]];
    const explained = text.filter(c => c.op !== 'moved').some(c => (c.bboxA && insideFrac(r.bbox, c.bboxA, pad) > 0.8) || (c.bboxB && insideFrac(bB0, c.bboxB, pad) > 0.8));
    if (explained) continue;
    const op = r.darkA > 3 * r.darkB ? 'removed' : r.darkB > 3 * r.darkA ? 'added' : 'modified';
    const bA: BBox = r.bbox, bB: BBox = [r.bbox[0] + offset[0], r.bbox[1] + offset[1], r.bbox[2] + offset[0], r.bbox[3] + offset[1]];
    out.push({ id: newId('g'), kind: 'graphics', op, pair, bboxA: op === 'added' ? null : bA, bboxB: op === 'removed' ? null : bB, gridRef: null, pixels: r.pixels });
  }
  // fallback pairing: a removed and an added region that overlap are one modification
  const used = new Set<Change>();
  for (const rem of out) {
    if (rem.op !== 'removed' || used.has(rem)) continue;
    const add = out.find(x => x.op === 'added' && !used.has(x) && boxesNear(rem.bboxA!, [x.bboxB![0] - offset[0], x.bboxB![1] - offset[1], x.bboxB![2] - offset[0], x.bboxB![3] - offset[1]], 0));
    if (!add) continue;
    used.add(add); rem.op = 'modified'; rem.bboxB = add.bboxB; rem.pixels = (rem.pixels ?? 0) + (add.pixels ?? 0);
  }
  return out.filter(c => !used.has(c));
}

/** Vector changes confirmed by the pixel diff -> Change objects; shapes moved together form one change. */
export function vectorChanges(vec0: VecChange[], pair: number, offset: [number, number]): Change[] {
  const r1 = (v: number) => Math.round(v * 10) / 10;
  const out: Change[] = [];
  let vec = vec0;
  const movedGroups: { d: [number, number]; cs: VecChange[]; box: BBox }[] = [];
  for (const v of vec) {
    if (v.op !== 'moved') continue;
    const d: [number, number] = [v.b.bbox[0] - offset[0] - v.a.bbox[0], v.b.bbox[1] - offset[1] - v.a.bbox[1]];
    const g = movedGroups.find(m => Math.hypot(m.d[0] - d[0], m.d[1] - d[1]) <= 1 && boxesNear(m.box, v.a.bbox, 20));
    if (g) { g.cs.push(v); g.box = unionBox([g.box, v.a.bbox])!; } else movedGroups.push({ d, cs: [v], box: v.a.bbox });
  }
  // merge groups that grew into each other
  for (let merged = true; merged;) {
    merged = false;
    for (let i = 0; i < movedGroups.length && !merged; i++) for (let j = i + 1; j < movedGroups.length && !merged; j++) {
      const p = movedGroups[i], q = movedGroups[j];
      if (Math.hypot(p.d[0] - q.d[0], p.d[1] - q.d[1]) <= 1 && boxesNear(p.box, q.box, 20)) {
        p.cs.push(...q.cs); p.box = unionBox([p.box, q.box])!; movedGroups.splice(j, 1); merged = true;
      }
    }
  }
  // small groups that sit inside a large coherent group with (almost) its displacement are part of it
  // (stroke boxes of thin lines shift by a fraction of a point against the fill boxes)
  for (const big of movedGroups.filter(g => g.cs.length >= 20)) {
    for (let k = movedGroups.length - 1; k >= 0; k--) {
      const q = movedGroups[k];
      if (q === big || q.cs.length >= 20 || Math.hypot(big.d[0] - q.d[0], big.d[1] - q.d[1]) > 3 || !boxesNear(big.box, q.box, 20)) continue;
      big.cs.push(...q.cs); big.box = unionBox([big.box, q.box])!; movedGroups.splice(k, 1);
    }
  }
  const median = (xs: number[]) => { const s = [...xs].sort((p, q) => p - q); return s[Math.floor(s.length / 2)]; };
  for (const g of movedGroups) {
    if (g.cs.length > 2) g.d = [median(g.cs.map(c => c.b.bbox[0] - offset[0] - c.a.bbox[0])), median(g.cs.map(c => c.b.bbox[1] - offset[1] - c.a.bbox[1]))];
    const one = g.cs.length === 1 ? g.cs[0] : null;
    out.push({ id: newId('v'), kind: 'graphics', op: 'moved', pair, bboxA: unionBox(g.cs.map(c => c.a.bbox)), bboxB: unionBox(g.cs.map(c => c.b.bbox)),
      gridRef: null, move: [r1(g.d[0]), r1(g.d[1])], shape: one ? shapeName(one.a) : `${g.cs.length} shapes` });
  }
  // shapes resized together (touching on both sides, e.g. a table border and its column lines growing for a new row)
  const resGroups: VecChange[][] = [];
  for (const v of vec) {
    if (v.op !== 'resized') continue;
    const g = resGroups.find(gr => gr.some(c => boxesNear(c.a.bbox, v.a.bbox, 2) && boxesNear(c.b.bbox, v.b.bbox, 2)));
    if (g) g.push(v); else resGroups.push([v]);
  }
  for (const g of resGroups.filter(gr => gr.length > 1)) {
    const a = unionBox(g.map(c => c.a.bbox))!, b = unionBox(g.map(c => c.b.bbox))!;
    const ua = { ...g[0].a, bbox: a }, ub = { ...g[0].b, bbox: b };
    vec = vec.filter(v => !g.includes(v));
    vec.push({ op: 'resized', a: ua, b: ub, detail: `group of ${g.length} shapes` });
  }
  for (const v of vec) {
    if (v.op === 'moved') continue;
    const wa = v.a.bbox[2] - v.a.bbox[0], ha = v.a.bbox[3] - v.a.bbox[1], wb = v.b.bbox[2] - v.b.bbox[0], hb = v.b.bbox[3] - v.b.bbox[1];
    const c: Change = { id: newId('v'), kind: 'graphics', op: v.op, pair, bboxA: v.a.bbox, bboxB: v.b.bbox, gridRef: null, shape: v.detail?.startsWith("group of") ? v.detail.slice(9) : shapeName(v.a) };
    if (v.op === 'resized') {
      c.sizeA = [r1(wa), r1(ha)]; c.sizeB = [r1(wb), r1(hb)];
      c.scale = [wa > 0.01 ? Math.round((wb / wa) * 100) / 100 : 0, ha > 0.01 ? Math.round((hb / ha) * 100) / 100 : 0];
      c.move = [r1(v.b.bbox[0] - offset[0] - v.a.bbox[0]), r1(v.b.bbox[1] - offset[1] - v.a.bbox[1])];
    } else c.detail = v.detail;
    out.push(c);
  }
  return out;
}

/** Fill `gridRef` of every change from its sheet's grid: one cell or a range; "old>new" for moved items. */
export function assignGridRefs(pr: PairResult): void {
  const g = pr.grid;
  for (const c of pr.changes) {
    if (!g) { c.gridRef = null; continue; }
    const bA = c.bboxA ? shiftBox(c.bboxA, pr.offset) : null, bB = c.bboxB; // A boxes in B's frame
    if ((c.op === 'moved' || c.op === 'resized') && bA && bB) {
      const ra = cellAt(g, (bA[0] + bA[2]) / 2, (bA[1] + bA[3]) / 2), rb = cellAt(g, (bB[0] + bB[2]) / 2, (bB[1] + bB[3]) / 2);
      c.gridRef = ra === rb ? gridRef(g, unionBox([bA, bB])!) : `${ra}>${rb}`;
    } else {
      const b = bB ?? bA;
      c.gridRef = b ? gridRef(g, b) : null;
    }
  }
}
const shiftBox = (b: BBox, o: [number, number]): BBox => [b[0] + o[0], b[1] + o[1], b[2] + o[0], b[3] + o[1]];

export function finalize(t: TextStageResult): DiffResult {
  t.perPair.forEach(assignGridRefs);
  const all = t.perPair.flatMap(p => p.changes);
  const nPaired = t.pairs.filter(p => p.a !== null && p.b !== null).length;
  const { folded } = foldRepeated(all, nPaired);
  const { offsetCandidates: _o, ...rest } = t;
  return { ...rest, folded };
}
