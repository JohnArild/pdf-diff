/** Shared data model for the diff engine and the UI. All coordinates are PDF points
 *  in the page's own top-left-origin space (viewport at scale 1). */
export type BBox = [number, number, number, number]; // x0, y0, x1, y1

export interface Word {
  text: string;
  bbox: BBox;
}

export interface PageData {
  index: number; // 0-based page index in its document
  width: number;
  height: number;
  words: Word[];
}

export interface DocData {
  name: string;
  pages: PageData[];
}

/** Title-block identity of a sheet, used for pairing and labelling. */
export interface SheetInfo {
  sheet: string | null; // e.g. "22/26"
  dwg: string | null; // drawing number if found
  rev: string | null; // revision letter if found
}

export interface PagePair {
  a: number | null; // page index in Rev A (null = inserted in B)
  b: number | null; // page index in Rev B (null = deleted from A)
  key: string; // pairing key (sheet number or "#n")
  by: 'sheet' | 'order';
  label: string; // "Sheet 22/26" or "Page 3"
}

export type ChangeKind = 'text' | 'graphics' | 'page';
export type ChangeOp = 'added' | 'removed' | 'modified';

export interface Change {
  id: string;
  kind: ChangeKind;
  op: ChangeOp;
  pair: number; // index into pairs[]
  bboxA: BBox | null; // location on Rev A page
  bboxB: BBox | null; // location on Rev B page
  before?: string;
  after?: string;
  /** short refined detail, e.g. char-level "3 → 4" */
  detail?: string;
  /** graphics: number of differing pixels / region area */
  pixels?: number;
  /** grid reference such as "D3" or "C2–C3"; null until grid detection (phase 2) */
  gridRef: string | null;
  /** title-block change etc.; filled by folding */
  foldKey?: string;
}

/** A change that occurs identically on many sheets, listed once. */
export interface FoldedChange {
  key: string;
  kind: ChangeKind;
  op: ChangeOp;
  before?: string;
  after?: string;
  pairs: number[]; // affected pair indices
  members: string[]; // change ids
}

export interface PairResult {
  pair: number;
  offset: [number, number]; // B minus A page offset (pt), compensated
  changes: Change[];
}

export interface DiffResult {
  pairs: PagePair[];
  sheetsA: SheetInfo[];
  sheetsB: SheetInfo[];
  perPair: PairResult[];
  folded: FoldedChange[];
}
