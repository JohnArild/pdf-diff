import type { BBox, Word } from './types';

/** Minimal shape of a pdf.js TextItem we rely on. */
export interface RawTextItem { str: string; transform: number[]; width: number; height: number }

/** Split pdf.js text items into positioned words (top-left origin, points). */
export function itemsToWords(items: RawTextItem[], pageHeight: number): Word[] {
  const out: Word[] = [];
  for (const it of items) {
    const s = it.str;
    if (!s || !s.trim()) continue;
    const [a, b, c, d, e, f] = it.transform;
    const len = Math.hypot(a, b) || 1;
    const ux = a / len, uy = b / len; // text direction (PDF space)
    const h = it.height || Math.hypot(c, d) || len;
    const total = it.width || len * s.length * 0.5;
    const n = s.length;
    const re = /\S+/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(s))) {
      const t0 = (m.index / n) * total, t1 = ((m.index + m[0].length) / n) * total;
      // four corners in PDF space (baseline start/end, plus height along the normal)
      const nx = -uy, ny = ux;
      const pts = [
        [e + ux * t0, f + uy * t0], [e + ux * t1, f + uy * t1],
        [e + ux * t0 + nx * h, f + uy * t0 + ny * h], [e + ux * t1 + nx * h, f + uy * t1 + ny * h],
      ];
      const xs = pts.map(p => p[0]), ys = pts.map(p => pageHeight - p[1]);
      const bbox: BBox = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
      out.push({ text: m[0], bbox });
    }
  }
  return out;
}

export const cx = (b: BBox) => (b[0] + b[2]) / 2;
export const cy = (b: BBox) => (b[1] + b[3]) / 2;

/** Sort words into reading order: lines by baseline band, then left to right. */
export function readingOrder(words: Word[]): Word[] {
  const ws = [...words].sort((p, q) => cy(p.bbox) - cy(q.bbox) || p.bbox[0] - q.bbox[0]);
  const lines: Word[][] = [];
  for (const w of ws) {
    const h = Math.max(1, w.bbox[3] - w.bbox[1]);
    const last = lines[lines.length - 1];
    if (last && Math.abs(cy(last[0].bbox) - cy(w.bbox)) < h * 0.5) last.push(w);
    else lines.push([w]);
  }
  return lines.flatMap(l => l.sort((p, q) => p.bbox[0] - q.bbox[0]));
}

export function unionBox(boxes: BBox[]): BBox | null {
  if (!boxes.length) return null;
  return [Math.min(...boxes.map(b => b[0])), Math.min(...boxes.map(b => b[1])), Math.max(...boxes.map(b => b[2])), Math.max(...boxes.map(b => b[3]))];
}

export function boxesNear(a: BBox, b: BBox, pad: number): boolean {
  return !(a[2] + pad < b[0] || b[2] + pad < a[0] || a[3] + pad < b[1] || b[3] + pad < a[1]);
}
