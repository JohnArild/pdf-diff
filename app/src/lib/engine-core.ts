/** Pure, worker-safe parts of the comparison pipeline. */
import type { BBox, Change, DiffResult, DocData, PairResult } from './types';
import { sheetInfo, pairPages } from './pairing';
import { diffWords, estimateOffset, newId } from './textdiff';
import { foldRepeated } from './folding';
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
      perPair.push({ pair: i, offset: [0, 0], changes: [{ id: newId('p'), kind: 'page', op: p.a === null ? 'added' : 'removed', pair: i, bboxA: null, bboxB: null, gridRef: null }] });
      offsetCandidates.push([0, 0]);
      return;
    }
    const wa = a.pages[p.a].words, wb = b.pages[p.b].words;
    const off = estimateOffset(wa, wb).offset;
    offsetCandidates.push(off);
    perPair.push({ pair: i, offset: [0, 0], changes: diffWords(wa, wb, i, off) });
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
    const explained = text.some(c => (c.bboxA && insideFrac(r.bbox, c.bboxA, pad) > 0.8) || (c.bboxB && insideFrac(bB0, c.bboxB, pad) > 0.8));
    if (explained) continue;
    const op = r.darkA > 3 * r.darkB ? 'removed' : r.darkB > 3 * r.darkA ? 'added' : 'modified';
    const bA: BBox = r.bbox, bB: BBox = [r.bbox[0] + offset[0], r.bbox[1] + offset[1], r.bbox[2] + offset[0], r.bbox[3] + offset[1]];
    out.push({ id: newId('g'), kind: 'graphics', op, pair, bboxA: op === 'added' ? null : bA, bboxB: op === 'removed' ? null : bB, gridRef: null, pixels: r.pixels });
  }
  return out;
}

export function finalize(t: TextStageResult): DiffResult {
  const all = t.perPair.flatMap(p => p.changes);
  const nPaired = t.pairs.filter(p => p.a !== null && p.b !== null).length;
  const { folded } = foldRepeated(all, nPaired);
  const { offsetCandidates: _o, ...rest } = t;
  return { ...rest, folded };
}
