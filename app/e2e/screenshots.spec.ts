import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { fileURLToPath } from 'node:url';
import { haveLip, haveSamples, LIP_NEW, LIP_OLD, loadPair, missingMsg, NEW, OLD, SCREENSHOTS } from './helpers';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');

mkdirSync(SCREENSHOTS, { recursive: true });
const shot = (page: Page, name: string) => page.screenshot({ path: path.join(SCREENSHOTS, name) });
const settle = (page: Page) => page.waitForTimeout(1500); // let the debounced page renders land

test('empty upload state', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('drop-a')).toBeVisible();
  await shot(page, '01-upload.png');
});

test('OpenHornet comparison, sheets 22 and 1, export dialog', async ({ page }) => {
  test.skip(!haveSamples, missingMsg);
  await loadPair(page, OLD, NEW);
  // sheet 22: click its change in the list (jumps and zooms to the note)
  await page.getByTestId('change-row').filter({ hasText: 'PAINT INSIDE' }).first().click();
  await expect(page.getByTestId('current-pair')).toContainText('22/26');
  await settle(page);
  await shot(page, '02-sheet22-note.png');
  // sheet 1 at fit-to-page
  await page.getByTestId('thumbs').locator('.th').first().click();
  await expect(page.getByTestId('current-pair')).toContainText('1/26');
  await settle(page);
  await shot(page, '03-sheet1.png');
  // sheet 1 zoomed onto the new revision-history row
  await page.getByTestId('change-row').filter({ hasText: 'FN 21' }).first().click();
  await settle(page);
  await shot(page, '04-sheet1-revision-row.png');
  await page.getByTestId('export-list').click();
  await expect(page.getByTestId('report')).toContainText('PDF DIFF REPORT');
  await shot(page, '05-export-dialog.png');
});

test('fixture hello_box_bare: moved text and resized box', async ({ page }) => {
  await loadPair(page, path.join(FIX, 'hello_box_bare_a.pdf'), path.join(FIX, 'hello_box_bare_b.pdf'));
  await settle(page);
  await shot(page, '06-hello-box.png');
  await page.getByTestId('change-row').filter({ hasText: 'Filled box resized' }).click();
  await settle(page);
  await shot(page, '07-hello-box-resized.png');
  await page.getByTestId('export-list').click();
  await expect(page.getByTestId('report')).toContainText('Resized');
  await shot(page, '08-hello-box-export.png');
});

test('OpenHornet OH2A2A1-1: sheet 1 with grid refs, export dialog', async ({ page }) => {
  test.skip(!haveLip, missingMsg);
  await loadPair(page, LIP_OLD, LIP_NEW);
  await settle(page);
  await shot(page, '09-lip-sheet1.png');
  await page.getByTestId('export-list').click();
  await expect(page.getByTestId('report')).toContainText('Border zone on 3/3 sheets');
  await shot(page, '10-lip-export.png');
});
