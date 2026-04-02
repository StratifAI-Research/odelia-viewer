import { Page, Locator } from '@playwright/test';

/**
 * Page Object Model for the Labeling Panel.
 * Encapsulates interactions with the labeling extension UI.
 */
export class LabelingPanel {
  readonly page: Page;
  readonly panel: Locator;
  readonly csvImportButton: Locator;
  readonly exportButton: Locator;
  readonly lesionTable: Locator;

  constructor(page: Page) {
    this.page = page;
    this.panel = page.locator('[data-cy="labeling-panel"]');
    this.csvImportButton = this.panel.locator('button:has-text("Import")');
    this.exportButton = this.panel.locator('button:has-text("Export")');
    this.lesionTable = this.panel.locator('[data-cy="lesion-table"]');
  }

  async waitForPanel() {
    await this.panel.waitFor({ state: 'visible', timeout: 15_000 });
  }

  async importCSV(filePath: string) {
    const fileChooserPromise = this.page.waitForEvent('filechooser');
    await this.csvImportButton.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(filePath);
  }

  async exportCSV() {
    const downloadPromise = this.page.waitForEvent('download');
    await this.exportButton.click();
    return downloadPromise;
  }
}
