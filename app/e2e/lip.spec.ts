import { expect, test } from '@playwright/test';
import { haveLip, LIP_NEW, LIP_OLD, loadPair, section } from './helpers';

// OpenHornet OH2A2A1-1 "ASSY, LEFT LIP MODULE", rev - (v6) -> rev A (v7): the ABSIS HID bus master board was
// replaced by the ABSIS bus master (BOM row 14, exploded view), and the isometric view was regenerated 15 pt lower.
// Grid refs were checked against the zone labels on the rendered sheet (columns 8..1 left to right, rows D..A top down).
test.skip(!haveLip, 'OpenHornet OH2A2A1-1 samples missing: run prototype/fetch_samples.sh first');

test('OpenHornet OH2A2A1-1 rev - -> rev A', async ({ page }) => {
  const s = await loadPair(page, LIP_OLD, LIP_NEW);
  console.log(s.report);
  expect(s.report).toContain('Grid       Border zone on 3/3 sheets, rows A-D, columns 1-8 (high confidence)');
  expect(s.report).toContain('All sheets   -       Modified  Text "-" -> "A" (3/3 sheets)');
  expect(s.report).toContain('Totals     10 changes: 2 added, 0 removed, 6 modified, 1 moved, 1 resized');
  const s1 = section(s.report, '1/3');
  expect(s1[0]).toContain('- 7 changes');
  const row = (re: RegExp) => expect(s1.filter(l => re.test(l)), String(re)).toHaveLength(1);
  // BOM row 14: find number and description changed in place (one Modified each, no removed+added pairs)
  row(/^Sheet 1\/3 +B3 +Modified +Text "ABSIS003" -> "ABSIS011"$/);
  row(/^Sheet 1\/3 +B2 +Modified +Text "\.\.\.HID BUS MASTER" -> "\.\.\.BUS MASTER"$/);
  // new revision-history row: one Added row, and the table outline growing by one row
  row(/^Sheet 1\/3 +D1–D2 +Added +Text "A FN 14: REPLACED ABSIS HID BUS MASTER/);
  row(/^Sheet 1\/3 +D1–D3 +Resized +4 shapes 557x56 -> 557x88 pt/);
  // exploded view: the new board
  row(/^Sheet 1\/3 +A4–A5 +Modified +Graphics \(55x35 mm region\)$/);
  // isometric view: one move of the whole view, plus the board's connector that is new inside it
  row(/^Sheet 1\/3 +B5–C8 +Moved +\d{4} shapes moved dx=\+0\.0 dy=-1[45]\.\d pt$/);
  row(/^Sheet 1\/3 +B7 +Added +Graphics \(10x7 mm region\)$/);
  // the BOM text "ABSIS HID BUS MASTER" must not be paired with the revision note as a move
  expect(s.report).not.toMatch(/Moved +Text/);
  expect(s.report).toContain('No other changes on 2 sheet(s): 2/3, 3/3');
  // sidebar rows carry the grid ref
  await expect(page.getByTestId('change-row').filter({ hasText: 'ABSIS011' })).toContainText('B3');
});

test('OH2A2A1-1 self vs self gives zero changes', async ({ page }) => {
  const s = await loadPair(page, LIP_NEW, LIP_NEW);
  expect(s.total).toBe(0);
});
