/** Main-thread orchestration: pdf.js loading/rendering, then diffing in Web Workers. */
import * as pdfjs from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { DiffResult, DocData, PageData } from './types';
import { itemsToWords, type RawTextItem } from './words';
import { finalize, graphicsChanges, type TextStageResult } from './engine-core';

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
    const res = await runWorker<{ offset: [number, number]; regions: import('./raster').RasterRegion[] }>(rw,
      { id: i, scale, a: { rgba: a.data, w: a.width, h: a.height }, b: bs,
        textA: t.perPair[i].changes.flatMap(c => (c.bboxA ? [c.bboxA] : [])), textB: t.perPair[i].changes.flatMap(c => (c.bboxB ? [c.bboxB] : [])) }, [a.data.buffer, ...bs.map(x => x.rgba.buffer)]);
    const pr = t.perPair[i];
    pr.offset = res.offset;
    pr.changes.push(...graphicsChanges(res.regions, pr.changes, i, res.offset));
  }
  rw.terminate();
  onProgress(total, total, 'Done');
  return finalize(t);
}
