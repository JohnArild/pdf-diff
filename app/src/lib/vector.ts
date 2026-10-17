import type { BBox } from './types';

/** A painted path from the page content, in page points (top-left origin). */
export interface Shape {
  bbox: BBox;
  /** rect = axis-aligned 4-corner box (from `re` or an equivalent m/l/h path), line = single segment */
  type: 'rect' | 'line' | 'path';
  paint: 'fill' | 'stroke' | 'fillstroke';
  fill: string | null;
  stroke: string | null;
  lw: number; // stroke width in page points
  n: number; // number of path points (0 when unknown)
  /** shape signature: the first up to 32 points normalised to the box (0..1), for matching moved/resized copies */
  sig?: number[];
}

/** Do two signatures describe the same outline (within `eps` of the normalised box)? */
export function sigClose(a: Shape, b: Shape, eps: number): boolean {
  if (!a.sig || !b.sig) return a.type === b.type && a.type !== 'path'; // rects and lines are fully described by their box
  if (a.sig.length !== b.sig.length) return false;
  for (let i = 0; i < a.sig.length; i++) if (Math.abs(a.sig[i] - b.sig[i]) > eps) return false;
  return true;
}

type M = [number, number, number, number, number, number];
const mul = (m: M, t: M): M => [
  m[0] * t[0] + m[2] * t[1], m[1] * t[0] + m[3] * t[1],
  m[0] * t[2] + m[2] * t[3], m[1] * t[2] + m[3] * t[3],
  m[0] * t[4] + m[2] * t[5] + m[4], m[1] * t[4] + m[3] * t[5] + m[5],
];
const apply = (m: M, x: number, y: number): [number, number] => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];

/** The subset of pdf.js `OPS` codes we read. */
export type OpsTable = Record<string, number>;

// pdf.js DrawOPS inside constructPath data
const D_MOVE = 0, D_LINE = 1, D_CURVE = 2, D_QUAD = 3, D_CLOSE = 4;

const toHex = (c: unknown): string | null => {
  if (typeof c === 'string') return c.toLowerCase();
  if (c && typeof c === 'object' && 'length' in (c as ArrayLike<number>)) {
    const a = c as ArrayLike<number>;
    return '#' + [a[0], a[1], a[2]].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  }
  return null;
};

/**
 * Extract painted paths from a pdf.js operator list (`page.getOperatorList()`), applying the CTM,
 * form XObject matrices and the page's viewport transform (scale 1), so boxes match text word boxes.
 * Text, images and shadings are not shapes; the raster diff covers them.
 */
export function extractShapes(fnArray: ArrayLike<number>, argsArray: ArrayLike<unknown>, OPS: OpsTable, viewportTransform: number[], maxShapes = 250000): Shape[] {
  const out: Shape[] = [];
  let ctm = viewportTransform.slice(0, 6) as M;
  let fill: string | null = '#000000', stroke: string | null = '#000000', lw = 1;
  const stack: { ctm: M; fill: string | null; stroke: string | null; lw: number }[] = [];
  const save = () => stack.push({ ctm, fill, stroke, lw });
  const restore = () => { const s = stack.pop(); if (s) ({ ctm, fill, stroke, lw } = s); };
  const paintOf = (op: number): Shape['paint'] | null => {
    if (op === OPS.fill || op === OPS.eoFill) return 'fill';
    if (op === OPS.stroke || op === OPS.closeStroke) return 'stroke';
    if (op === OPS.fillStroke || op === OPS.eoFillStroke || op === OPS.closeFillStroke || op === OPS.closeEOFillStroke) return 'fillstroke';
    return null; // endPath (clip only) etc.
  };
  for (let i = 0; i < fnArray.length && out.length < maxShapes; i++) {
    const fn = fnArray[i], args = argsArray[i] as unknown[] | null;
    switch (fn) {
      case OPS.save: save(); break;
      case OPS.restore: restore(); break;
      case OPS.transform: ctm = mul(ctm, args as unknown as M); break;
      case OPS.paintFormXObjectBegin: {
        save();
        const m = args?.[0] as number[] | null;
        if (m && m.length === 6) ctm = mul(ctm, Array.from(m) as M);
        break;
      }
      case OPS.paintFormXObjectEnd: restore(); break;
      case OPS.setLineWidth: lw = Number(args?.[0]) || 0; break;
      case OPS.setGState: {
        for (const [k, v] of (args?.[0] as [string, unknown][]) ?? []) if (k === 'LW') lw = Number(v) || 0;
        break;
      }
      case OPS.setFillRGBColor: fill = toHex(args?.[0]); break;
      case OPS.setStrokeRGBColor: stroke = toHex(args?.[0]); break;
      case OPS.setFillTransparent: fill = null; break;
      case OPS.setStrokeTransparent: stroke = null; break;
      case OPS.constructPath: {
        const paint = paintOf(args?.[0] as number);
        if (!paint) break;
        const data = (args?.[1] as unknown[] | undefined)?.[0];
        const xs: number[] = [], ys: number[] = [];
        let subpaths = 0;
        if (data && typeof data === 'object' && 'length' in (data as object)) {
          const d = data as ArrayLike<number>;
          const pt = (x: number, y: number) => { const p = apply(ctm, x, y); xs.push(p[0]); ys.push(p[1]); };
          for (let k = 0; k < d.length;) {
            switch (d[k++]) {
              case D_MOVE: subpaths++; pt(d[k++], d[k++]); break;
              case D_LINE: pt(d[k++], d[k++]); break;
              case D_CURVE: pt(d[k++], d[k++]); pt(d[k++], d[k++]); pt(d[k++], d[k++]); break;
              case D_QUAD: pt(d[k++], d[k++]); pt(d[k++], d[k++]); break;
              case D_CLOSE: break;
              default: k = d.length; // unknown encoding: stop
            }
          }
        } else {
          // path already turned into a Path2D by a renderer: fall back to its local min/max box
          const mm = args?.[2] as ArrayLike<number> | null;
          if (!mm) break;
          for (const [x, y] of [[mm[0], mm[1]], [mm[2], mm[1]], [mm[0], mm[3]], [mm[2], mm[3]]]) { const p = apply(ctm, x, y); xs.push(p[0]); ys.push(p[1]); }
        }
        if (!xs.length) break;
        const bbox: BBox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
        const scaleLw = lw * Math.sqrt(Math.abs(ctm[0] * ctm[3] - ctm[1] * ctm[2]));
        const bw = Math.max(bbox[2] - bbox[0], 1e-6), bh = Math.max(bbox[3] - bbox[1], 1e-6);
        const sig: number[] = [];
        for (let k = 0; k < Math.min(xs.length, 32); k++) sig.push(Math.round(((xs[k] - bbox[0]) / bw) * 1000) / 1000, Math.round(((ys[k] - bbox[1]) / bh) * 1000) / 1000);
        out.push({ sig, bbox, type: classify(xs, ys, subpaths, data !== undefined && data !== null && typeof data === 'object' && 'length' in (data as object)), paint,
          fill: paint === 'stroke' ? null : fill, stroke: paint === 'fill' ? null : stroke, lw: paint === 'fill' ? 0 : Math.round(scaleLw * 100) / 100, n: xs.length });
        break;
      }
    }
  }
  return out;
}

function classify(xs: number[], ys: number[], subpaths: number, exact: boolean): Shape['type'] {
  if (!exact || subpaths !== 1) return 'path';
  let n = xs.length;
  if (n >= 2 && Math.abs(xs[0] - xs[n - 1]) < 1e-3 && Math.abs(ys[0] - ys[n - 1]) < 1e-3) n--; // explicit closing point
  if (n === 2) return 'line';
  if (n !== 4) return 'path';
  for (let i = 0; i < 4; i++) {
    const j = (i + 1) % 4;
    const dx = Math.abs(xs[j] - xs[i]), dy = Math.abs(ys[j] - ys[i]);
    if (Math.min(dx, dy) > 0.01) return 'path'; // edge not axis-aligned
  }
  return 'rect';
}

/** Human name of a shape for the change list. */
export function shapeName(s: Pick<Shape, 'type' | 'paint'>): string {
  if (s.type === 'line') return 'Line';
  if (s.type === 'rect') return s.paint === 'stroke' ? 'Box outline' : 'Filled box';
  return s.paint === 'stroke' ? 'Shape' : 'Filled shape';
}
