import { expect, test } from '@playwright/test';

// Every layout, from the deterministic mock (?mockFreeze=1) at a
// fixed time, with reduced motion so nothing is mid-animation.
const FIXED_TIME = new Date('2026-10-14T10:30:00Z');
const LAYOUTS = [
  { layout: 'tablet', width: 1180, height: 820 },
  { layout: 'phone', width: 412, height: 915 },
  { layout: 'desktop', width: 1920, height: 1080 },
] as const;

for (const { layout, width, height } of LAYOUTS) {
  test(layout, async ({ page }) => {
    await page.clock.setFixedTime(FIXED_TIME);
    await page.setViewportSize({ width, height });
    await page.goto(`/index.html?layout=${layout}&mockFreeze=1`);
    // Wait for async mock data: the phone's home tab shows rooms; the others
    // also need the forecast icons and the 24h peak.
    await expect(page.locator('.room-row').first()).toBeVisible();
    if (layout !== 'phone') {
      await expect(page.locator('.wx-img').first()).toBeVisible();
      await expect(page.locator('.energy-panel .panel-summary')).toContainText('peak');
    }
    await page.waitForTimeout(400);
    await expect(page).toHaveScreenshot(`${layout}.png`);
  });
}
