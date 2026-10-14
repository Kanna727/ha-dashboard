import { defineConfig } from '@playwright/test';

// Visual checks (`npm run test:visual`): screenshots of the mock build compared
// against baselines in tests/visual/__screenshots__. Baselines are made on Linux
// by the "Update visual baselines" workflow; fonts render differently elsewhere.
// Build the mock first: VITE_MOCK=1 npx vite build --outDir dist-mock
export default defineConfig({
  testDir: 'tests/visual',
  snapshotPathTemplate: '{testDir}/__screenshots__/{arg}{ext}',
  fullyParallel: true,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  expect: { toHaveScreenshot: { maxDiffPixelRatio: 0.01, animations: 'disabled' } },
  use: {
    baseURL: 'http://127.0.0.1:4173',
    browserName: 'chromium',
    // PW_CHANNEL=chrome runs locally against an installed Chrome instead of the bundled one.
    channel: process.env.PW_CHANNEL || undefined,
    locale: 'en-US',
    timezoneId: 'UTC',
    contextOptions: { reducedMotion: 'reduce' },
  },
  webServer: {
    command: 'npx vite preview --outDir dist-mock --port 4173 --strictPort',
    url: 'http://127.0.0.1:4173/index.html',
    reuseExistingServer: !process.env.CI,
  },
});
