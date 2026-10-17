import { expect, test } from '@playwright/test';
import { haveSamples, loadPair, missingMsg, NEW, OLD, section } from './helpers';

test.skip(!haveSamples, missingMsg);

test('OpenHornet OHC0003 rev - -> rev A', async ({ page }) => {
  const s = await loadPair(page, OLD, NEW);
  console.log(s.report);
  // REV "-" -> "A" folded into one document-level row covering all 26 sheets
  const rev = s.folded.find(f => f.before === '-' && f.after === 'A');
  expect(rev?.pairs.length).toBe(26);
  expect(s.report).toContain('All sheets   -       Modified  Text "-" -> "A" (26/26 sheets)');
  // sheet 1: added revision-history row
  const s1 = section(s.report, '1/26');
  // ... and the revision-history table outline + 3 column lines grow by one row: one grouped "Resized" change
  expect(s1[0]).toContain('- 2 changes');
  // grid refs from the sheet's border zones (D..A, 8..1): the revision block is in the top right corner
  expect(s1.some(l => /D1–D3\s+Resized\s+4 shapes 557x56 -> 557x88 pt/.test(l))).toBe(true);
  expect(s1.some(l => /D1–D2\s+Added\s+Text "A FN 21: EXTENDED INDICA/.test(l))).toBe(true);
  // sheet 22: added paint note
  const s22 = section(s.report, '22/26');
  expect(s22.some(l => /Added\s+Text "PAINT INSIDE OF/.test(l))).toBe(true);
  // ... and its new leader line, reported as graphics
  expect(s22.some(l => /Added\s+Graphics/.test(l))).toBe(true);
  expect(s22[0]).toContain('- 2 changes');
  expect(s.report).toMatch(/^Rev A .* Rev -   26 pages$/m);
  expect(s.report).toMatch(/^Rev B .* Rev A   26 pages$/m);
  expect(s.report).toContain('Totals     30 changes: 3 added, 0 removed, 26 modified, 1 resized');
  expect(s.report).toContain('No other changes on 24 sheet(s)');
  // UI: the counts and the folded row are shown
  await expect(page.getByTestId('folded-row').first()).toContainText('All sheets');
  await expect(page.getByTestId('current-pair')).toContainText('1/26');
});

test('self vs self gives zero changes', async ({ page }) => {
  const s = await loadPair(page, NEW, NEW);
  expect(s.total).toBe(0);
  expect(s.report).toContain('Totals     0 changes');
  await expect(page.getByTestId('change-list')).toContainText('No differences found');
});
