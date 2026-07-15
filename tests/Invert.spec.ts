import { test } from '@playwright/test';
import { visitStudy, checkForScreenshot, screenShotPaths } from './utils';

test.beforeEach(async ({ page }) => {
  const studyInstanceUID = '1.3.6.1.4.1.25403.345050719074.3824.20170125095438.5';
  const mode = 'viewer';
  await visitStudy(page, studyInstanceUID, mode, 2000);
});

test('should invert the image', async ({ page }) => {
  // Wait until the stack viewport has actually loaded an image, otherwise the
  // invert can be applied before the image is ready and then overwritten by the
  // viewport's async default-property setup, leaving a non-inverted render.
  await page.waitForFunction(
    () => {
      const cornerstone = window.cornerstone;
      const viewport = cornerstone?.getEnabledElements?.()[0]?.viewport;
      const imageIds = viewport?.getImageIds?.() ?? [];
      return imageIds.length > 0;
    },
    { timeout: 15000 }
  );
  // Let the viewport's async default-property (VOI/LUT) setup finish before
  // toggling invert; otherwise that setup can overwrite the invert flag.
  await page.waitForTimeout(1500);

  await page.getByTestId('MoreTools-split-button-secondary').click();
  await page.waitForTimeout(500);
  await page.getByTestId('invert').click();

  // Confirm the invert property actually took effect before screenshotting.
  await page.waitForFunction(
    () => {
      const cornerstone = window.cornerstone;
      const viewport = cornerstone?.getEnabledElements?.()[0]?.viewport;
      return viewport?.getProperties?.()?.invert === true;
    },
    { timeout: 10000 }
  );

  await checkForScreenshot(page, page, screenShotPaths.invert.invertDisplayedCorrectly);
});
