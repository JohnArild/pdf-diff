import type { DocData, PageData, Word } from './types';
/** Lay out a line of words starting at (x, y); 5 pt per char, 8 pt tall, 5 pt gap. */
export function line(text: string, x: number, y: number, h = 8): Word[] {
  const out: Word[] = [];
  for (const t of text.split(/\s+/).filter(Boolean)) { out.push({ text: t, bbox: [x, y, x + t.length * 5, y + h] }); x += t.length * 5 + 5; }
  return out;
}
export const page = (index: number, words: Word[], width = 612, height = 792): PageData => ({ index, width, height, words });
export const doc = (name: string, pages: PageData[]): DocData => ({ name, pages });
/** A title block with SHEET n/m, DWG and REV fields in the bottom-right corner. */
export function titleBlock(n: number, m: number, rev: string, dwg = 'OHC0003'): Word[] {
  return [...line('DWG NO', 400, 740), ...line(dwg, 400, 752, 12), ...line('REV', 520, 740), ...line(rev, 522, 752), ...line('SHEET', 400, 770), ...line(`${n}/${m}`, 440, 770)];
}
