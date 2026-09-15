import { test, expect } from './utils';
import { addOHIFConfiguration } from './utils/OHIFConfiguration';

for (const variant of ['default', 'legacy']) {
  test(`release notification is limited to the ${variant} patient list and remembers dismissal`, async ({
    page,
    DOMOverlayPageObject,
  }) => {
    await addOHIFConfiguration(page, {
      viewerUpdates: { enabled: true },
      customizationService: [
        {
          'workList.variant': { $set: variant },
        },
      ],
    });
    let requests = 0;
    await page.route(
      'https://api.github.com/repos/StratifAI-Research/odelia-viewer/releases/latest',
      async route => {
        requests++;
        await route.fulfill({
          json: {
            tag_name: 'v99.0.0',
            draft: false,
            prerelease: false,
            html_url: 'https://github.com/StratifAI-Research/odelia-viewer/releases/tag/v99.0.0',
          },
        });
      }
    );
    await page.goto('/');
    const notice = DOMOverlayPageObject.viewerUpdate;
    await expect(notice.locator).toBeVisible({ timeout: 45000 });
    await expect(notice.locator).toContainText('99.0.0');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(notice.locator).toBeVisible();
    await page.mouse.click(5, 5);
    await expect(notice.locator).toBeVisible();
    await notice.dismiss.click();
    await expect(notice.locator).toBeHidden();
    await page.reload();
    await expect(notice.patientList).toHaveCount(1, { timeout: 30000 });
    await expect(notice.locator).toBeHidden();
    expect(requests).toBe(1);

    // A direct non-list route must not show even an unacknowledged cached release.
    await page.evaluate(() => {
      for (const key of Object.keys(localStorage)) {
        if (key.includes(':dismissed:')) {
          localStorage.removeItem(key);
        }
      }
    });
    await page.goto('/notfoundstudy');
    await expect(DOMOverlayPageObject.viewerUpdate.locator).toBeHidden();
  });
}
