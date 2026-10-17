/** Main-thread orchestration: pdf.js loading/rendering, then diffing in Web Workers. */
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { DiffResult, DocData, PageData } from './types';
import { itemsToWords, type RawTextItem } from './words';
import { finalize, graphicsChanges, vectorChanges, type TextStageResult } from './engine-core';
import { detectGrid } from './grid';
import { extractShapes, type OpsTable, type Shape } from './vector';
import type { RasterJob, RasterResult } from '../workers/raster.worker';

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
export type PDFDoc = pdfjs.PDFDocumentProxy;

export interface LoadedDoc { file: File; pdf: PDFDoc; data: DocData }

export async function loadDoc(file: File): Promise<LoadedDoc> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjs.getDocument({ data: buf }).promise;
  const pages: PageData[] = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const page = await pdf.getPage(i + 1);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const items = (tc.items as unknown[]).filter(it => typeof (it as { str?: unknown }).str === 'string') as RawTextItem[];
    pages.push({ index: i, width: vp.width, height: vp.height, words: itemsToWords(items, vp.height) });
  }
  return { file, pdf, data: { name: file.name, pages } };
}

/** Render a page into a canvas. `shift` (points) moves the content up/left (used to align Rev B onto Rev A). */
export async function renderPage(pdf: PDFDoc, index: number, scale: number, canvas?: HTMLCanvasElement, shift: [number, number] = [0, 0]) {
  const page = await pdf.getPage(index + 1);
  const vp = page.getViewport({ scale, offsetX: -shift[0] * scale, offsetY: -shift[1] * scale });
  const c = canvas ?? document.createElement('canvas');
  c.width = Math.ceil(vp.width); c.height = Math.ceil(vp.height);
  const ctx = c.getContext('2d', { willReadFrequently: !canvas })!;
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  await page.render({ canvasContext: ctx, canvas: c, viewport: vp }).promise;
  return c;
}

function runWorker<T>(w: Worker, msg: unknown, transfer: Transferable[] = []): Promise<T> {
  return new Promise((res, rej) => {
    w.onmessage = e => res(e.data as T);
    w.onerror = e => rej(e);
    w.postMessage(msg, transfer);
  });
}

/** Raster diff resolution: 150 DPI, capped so the long side stays within RASTER_MAX_PX pixels. */
/** Painted paths of one page from its operator list (separate from the render cache, so data is untouched). */
export async function pageShapes(pdf: PDFDoc, index: number): Promise<Shape[]> {
  const page = await pdf.getPage(index + 1);
  const ol = await page.getOperatorList();
  return extractShapes(ol.fnArray, ol.argsArray, pdfjs.OPS as unknown as OpsTable, page.getViewport({ scale: 1 }).transform);
}

export const RASTER_DPI = 150;
export const RASTER_MAX_PX = 4200;

export async function compare(A: LoadedDoc, B: LoadedDoc, onProgress: (done: number, total: number, stage: string) => void): Promise<DiffResult> {
  const tw = new Worker(new URL('../workers/text.worker.ts', import.meta.url), { type: 'module' });
  onProgress(0, 1, 'Comparing text');
  const tr = await runWorker<{ ok: boolean; result: TextStageResult; error?: string }>(tw, { a: A.data, b: B.data });
  tw.terminate();
  if (!tr.ok) throw new Error(tr.error);
  const t = tr.result;
  const rw = new Worker(new URL('../workers/raster.worker.ts', import.meta.url), { type: 'module' });
  const total = t.pairs.length;
  for (let i = 0; i < total; i++) {
    const p = t.pairs[i];
    onProgress(i, total, 'Comparing graphics');
    if (p.a === null || p.b === null) continue;
    const pg = A.data.pages[p.a];
    const scale = Math.min(RASTER_DPI / 72, RASTER_MAX_PX / Math.max(pg.width, pg.height));
    const ca = await renderPage(A.pdf, p.a, scale);
    const a = ca.getContext('2d')!.getImageData(0, 0, ca.width, ca.height);
    const cands: [number, number][] = [[0, 0]];
    const oc = t.offsetCandidates[i];
    if (oc[0] !== 0 || oc[1] !== 0) cands.push(oc);
    const bs = [];
    for (const off of cands) {
      const cb = await renderPage(B.pdf, p.b, scale, undefined, off);
      const d = cb.getContext('2d')!.getImageData(0, 0, cb.width, cb.height);
      bs.push({ rgba: d.data, w: d.width, h: d.height, offset: off });
    }
    const [shapesA, shapesB] = await Promise.all([pageShapes(A.pdf, p.a), pageShapes(B.pdf, p.b)]);
    const wordsA = A.data.pages[p.a].words.map(w => w.bbox), wordsB = B.data.pages[p.b].words.map(w => w.bbox);
    const res = await runWorker<RasterResult>(rw,
      { id: i, scale, a: { rgba: a.data, w: a.width, h: a.height }, b: bs, textA: wordsA, textB: wordsB, shapesA, shapesB } satisfies RasterJob,
      [a.data.buffer, ...bs.map(x => x.rgba.buffer)]);
    const pr = t.perPair[i];
    pr.offset = res.offset;
    // refine the grid with border tick marks from the vector layer
    const pb = B.data.pages[p.b], pa = A.data.pages[p.a];
    pr.grid = detectGrid(pb.words, pb.width, pb.height, shapesB) ?? detectGrid(pa.words, pa.width, pa.height, shapesA) ?? pr.grid;
    pr.changes.push(...vectorChanges(res.vec, i, res.offset));
    pr.changes.push(...graphicsChanges(res.regions, pr.changes, i, res.offset));
    // a style change of a shape inside a reported graphics region is part of that region
    const regs = pr.changes.filter(c => c.kind === 'graphics' && c.pixels !== undefined);
    pr.changes = pr.changes.filter(c => !(c.kind === 'graphics' && c.op === 'modified' && c.pixels === undefined && c.bboxB &&
      regs.some(r => r !== c && r.bboxB && c.bboxB![0] >= r.bboxB[0] - 3 && c.bboxB![1] >= r.bboxB[1] - 3 && c.bboxB![2] <= r.bboxB[2] + 3 && c.bboxB![3] <= r.bboxB[3] + 3)));
  }
  rw.terminate();
  onProgress(total, total, 'Done');
  return finalize(t);
}
