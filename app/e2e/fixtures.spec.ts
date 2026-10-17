import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from '@playwright/test';
import { loadPair } from './helpers';

const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures');
const pair = (name: string) => [path.join(FIX, `${name}_a.pdf`), path.join(FIX, `${name}_b.pdf`)] as const;
const rows = (report: string) => report.split('\n').filter(l => l.startsWith('Page 1  '));

const expected: Record<string, RegExp[]> = {
  hello_box_bare: [/Moved\s+Text "Hello" moved dx=\+120\.0 dy=\+40\.0 pt/, /Resized\s+Filled box 100x60 -> 160x90 pt \(x1\.60 x1\.50\)/],
  hello_box: [/Moved\s+Text "Hello" moved dx=\+120\.0 dy=\+40\.0 pt/, /Resized\s+Filled box 100x60 -> 160x90 pt/],
  text_move_50: [/Moved\s+Text "Hello" moved dx=\+50\.0 dy=\+0\.0 pt/],
  text_move_150: [/Moved\s+Text "Hello" moved dx=\+150\.0 dy=\+100\.0 pt/],
  box_resize_corner: [/Resized\s+Filled box 100x60 -> 160x90 pt/],
  box_resize_center: [/Resized\s+Filled box 100x60 -> 160x90 pt/],
  box_resize_path: [/Resized\s+Filled box 100x60 -> 160x90 pt/],
  box_resize_cm: [/Resized\s+Filled box 100x60 -> 160x90 pt/],
  box_move: [/Moved\s+Filled box moved dx=\+200\.0 dy=\+100\.0 pt/],
  box_color: [/Modified\s+Filled box \(100x60 pt\) fill #000000 -> #e61a1a/],
  combo: [/Moved\s+Text "Hello" moved dx=\+60\.0 dy=-50\.0 pt/, /Resized\s+Filled box 100x60 -> 160x90 pt/, /Moved\s+Filled box moved dx=\+0\.0 dy=\+80\.0 pt/, /Added\s+Graphics/],
};

for (const [name, want] of Object.entries(expected)) {
  test(`fixture ${name}`, async ({ page }) => {
    const s = await loadPair(page, ...pair(name));
    const got = rows(s.report);
    for (const re of want) expect(got.some(l => re.test(l)), `${re} in\n${got.join('\n')}`).toBe(true);
    expect(got).toHaveLength(want.length); // nothing else: text never shows up as graphics, no extra regions
  });
}

test('fixtures: self vs self is clean', async ({ page }) => {
  const s = await loadPair(page, path.join(FIX, 'combo_b.pdf'), path.join(FIX, 'combo_b.pdf'));
  expect(s.total).toBe(0);
});

test('fixture hello_box_bare: sidebar shows moved/resized', async ({ page }) => {
  await loadPair(page, ...pair('hello_box_bare'));
  await expect(page.getByTestId('count-moved')).toHaveText('2');
  await expect(page.getByTestId('change-row').filter({ hasText: 'Text moved' })).toContainText('dx +120.0 dy +40.0 pt');
  await expect(page.getByTestId('change-row').filter({ hasText: 'Filled box resized' })).toContainText('100×60 → 160×90 · ×1.60 ×1.50');
  await expect(page.locator('.hl rect.h-moved')).toHaveCount(2); // on A and on B
  await expect(page.locator('.hl rect.h-resized')).toHaveCount(2);
});
