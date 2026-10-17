import { defineConfig } from '@playwright/test';

// Uses an installed Chrome when present (CHROME_PATH or /usr/bin/google-chrome); otherwise Playwright's bundled Chromium
// (run `npx playwright install chromium` once).
import { existsSync } from 'node:fs';
const chrome = process.env.CHROME_PATH ?? (existsSync('/usr/bin/google-chrome') ? '/usr/bin/google-chrome' : undefined);

export default defineConfig({
  testDir: 'e2e',
  timeout: 240_000,
  expect: { timeout: 180_000 },
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5173',
    viewport: { width: 1600, height: 960 },
    launchOptions: chrome ? { executablePath: chrome } : {},
  },
  webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true, timeout: 60_000 },
});
