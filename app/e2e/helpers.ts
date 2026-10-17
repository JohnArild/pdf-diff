import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { expect, type Page } from '@playwright/test';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SAMPLES = path.resolve(here, '../../prototype/samples');
export const OLD = path.join(SAMPLES, 'OHC0003_rev-_v28.pdf');
export const NEW = path.join(SAMPLES, 'OHC0003_revA_v29.pdf');
export const SCREENSHOTS = path.resolve(here, '../../docs/screenshots');
export const haveSamples = existsSync(OLD) && existsSync(NEW);
export const LIP_OLD = path.join(SAMPLES, 'OH2A2A1-1_rev-_v6.pdf');
export const LIP_NEW = path.join(SAMPLES, 'OH2A2A1-1_revA_v7.pdf');
export const haveLip = existsSync(LIP_OLD) && existsSync(LIP_NEW);
export const missingMsg = 'OpenHornet samples missing: run prototype/fetch_samples.sh first';

export interface Snapshot { report: string; total: number; folded: { before?: string; after?: string; pairs: number[] }[] }

export async function loadPair(page: Page, a: string, b: string): Promise<Snapshot> {
  await page.goto('/');
  await page.getByTestId('file-a').setInputFiles(a);
  await page.getByTestId('file-b').setInputFiles(b);
  await page.waitForFunction(() => !!window.__pdfdiff, null, { timeout: 180_000 });
  await expect(page.getByTestId('sidebar')).toBeVisible();
  return page.evaluate(() => {
    const { result, report } = window.__pdfdiff!;
    return {
      report,
      total: result.perPair.reduce((n, p) => n + p.changes.length, 0),
      folded: result.folded.map(f => ({ before: f.before, after: f.after, pairs: f.pairs })),
    };
  });
}

/** Lines of the report section for one sheet ("Sheet 22/26 ..." up to the blank line). */
export function section(report: string, sheet: string): string[] {
  const lines = report.split('\n');
  const i = lines.findIndex(l => l.startsWith(`Sheet ${sheet} `));
  if (i < 0) return [];
  const out: string[] = [];
  for (let j = i; j < lines.length && lines[j] !== ''; j++) out.push(lines[j]);
  return out;
}
