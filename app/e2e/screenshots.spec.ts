import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import { haveSamples, loadPair, missingMsg, NEW, OLD, SCREENSHOTS } from './helpers';

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
