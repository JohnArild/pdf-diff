import type { DocData, PagePair, PageData, SheetInfo, Word } from './types';
import { cx, cy } from './words';

const SHEET_RE = /^(\d+)\s*\/\s*(\d+)$/;

/** Read sheet number, drawing number and revision from title-block words. */
export function sheetInfo(page: PageData): SheetInfo {
  const ws = page.words;
  const labels = (t: string) => ws.filter(w => w.text.toUpperCase() === t);
  const near = (label: Word, pred: (w: Word) => boolean, dx: [number, number], dy: [number, number]) =>
    ws.filter(w => w !== label && pred(w) && w.bbox[0] - label.bbox[0] > dx[0] && w.bbox[0] - label.bbox[0] < dx[1]
      && w.bbox[1] - label.bbox[1] > dy[0] && w.bbox[1] - label.bbox[1] < dy[1]);
  // "SHEET 2/26" (value on the same line, to the right) or "SHEET" label with value below
  let sheet: string | null = null, sheetWord: Word | null = null;
  for (const L of labels('SHEET')) {
    const c = near(L, w => SHEET_RE.test(w.text), [-10, 220], [-8, 40]);
    if (c.length) { sheet = c[0].text.replace(/\s+/g, ''); sheetWord = L; break; }
  }
  if (!sheet) {
    // "SHEET 3 OF 6"
    for (const L of labels('SHEET')) {
      const row = ws.filter(w => Math.abs(cy(w.bbox) - cy(L.bbox)) < 6 && w.bbox[0] > L.bbox[0]).sort((p, q) => p.bbox[0] - q.bbox[0]);
      const i = row.findIndex(w => w.text.toUpperCase() === 'OF');
      if (i > 0 && /^\d+$/.test(row[i - 1].text) && row[i + 1] && /^\d+$/.test(row[i + 1].text)) { sheet = `${row[i - 1].text}/${row[i + 1].text}`; break; }
    }
  }
  if (!sheet) {
    const c = ws.filter(w => SHEET_RE.test(w.text));
    if (c.length === 1) sheet = c[0].text;
  }
  let dwg: string | null = null;
  for (const L of labels('DWG')) {
    const c = near(L, w => w.text.length >= 4 && /\d/.test(w.text) && !['SIZE', 'REV'].includes(w.text), [-10, 400], [-5, 40]);
    if (c.length) { dwg = c.sort((p, q) => (q.bbox[3] - q.bbox[1]) - (p.bbox[3] - p.bbox[1]))[0].text; break; }
  }
  // REV: a revision-history table also has a "REV" column, so prefer the label closest to the SHEET label
  // (title block), else the lowest one on the page.
  let rev: string | null = null, best = Infinity;
  for (const L of labels('REV')) {
    const c = near(L, w => /^([A-Z]{1,2}|-|\d{1,2})$/.test(w.text), [-15, 30], [3, 40]);
    if (!c.length) continue;
    const score = sheetWord ? Math.hypot(cx(L.bbox) - cx(sheetWord.bbox), cy(L.bbox) - cy(sheetWord.bbox)) : -L.bbox[1];
    if (score < best) { best = score; rev = c.sort((p, q) => (q.bbox[3] - q.bbox[1]) - (p.bbox[3] - p.bbox[1]))[0].text; }
  }
  return { sheet, dwg, rev };
}

/** Sheet number without the total ("3/26" -> "3"), so pairing survives a change in sheet count. */
const sheetNo = (s: string | null) => (s ? s.split('/')[0].trim() : null);

/** Pair pages by title-block sheet number where both sides have unique numbers, else by page order. */
export function pairPages(a: DocData, b: DocData, sa: SheetInfo[], sb: SheetInfo[]): PagePair[] {
  const uniq = (s: SheetInfo[]) => {
    const keys = s.map(x => sheetNo(x.sheet));
    return keys.every(k => k) && new Set(keys).size === keys.length;
  };
  const pairs: PagePair[] = [];
  if (uniq(sa) && uniq(sb) && sa.some(x => sb.some(y => sheetNo(y.sheet) === sheetNo(x.sheet)))) {
    const bIdx = new Map(sb.map((s, i) => [sheetNo(s.sheet) as string, i]));
    const usedB = new Set<number>();
    sa.forEach((s, i) => {
      const j = bIdx.get(sheetNo(s.sheet) as string);
      if (j !== undefined) { usedB.add(j); pairs.push({ a: i, b: j, key: sheetNo(s.sheet) as string, by: 'sheet', label: `Sheet ${sb[j].sheet}` }); }
      else pairs.push({ a: i, b: null, key: sheetNo(s.sheet) as string, by: 'sheet', label: `Sheet ${s.sheet}` });
    });
    sb.forEach((s, j) => { if (!usedB.has(j)) pairs.push({ a: null, b: j, key: sheetNo(s.sheet) as string, by: 'sheet', label: `Sheet ${s.sheet}` }); });
    // keep document order of B (inserted pages appear where they are in B)
    pairs.sort((p, q) => (p.b ?? (p.a as number) - 0.5) - (q.b ?? (q.a as number) - 0.5));
    return pairs;
  }
  const n = Math.max(a.pages.length, b.pages.length);
  for (let i = 0; i < n; i++) {
    const ia = i < a.pages.length ? i : null, ib = i < b.pages.length ? i : null;
    const s = (ib !== null ? sb[ib]?.sheet : null) ?? (ia !== null ? sa[ia]?.sheet : null);
    pairs.push({ a: ia, b: ib, key: `#${i}`, by: 'order', label: s ? `Sheet ${s}` : `Page ${i + 1}` });
  }
  return pairs;
}

export { cx };
