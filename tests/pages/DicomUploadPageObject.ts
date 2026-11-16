import type { Page } from '@playwright/test';

export class DicomUploadPageObject {
  constructor(private page: Page) {}
  get openButton() {
    return this.page.getByTestId('dicom-upload-open');
  }
  get files() {
    return this.page.getByTestId('dicom-upload-files');
  }
  get folder() {
    return this.page.getByTestId('dicom-upload-folder');
  }
  get dropzone() {
    return this.page.getByTestId('dicom-upload-dropzone');
  }
  get selectionError() {
    return this.page.getByTestId('dicom-upload-selection-error');
  }
  get summary() {
    return this.page.getByTestId('dicom-upload-summary');
  }
  get results() {
    return this.page.getByTestId('dicom-upload-results');
  }
  get rows() {
    return this.page.getByTestId('dicom-upload-result');
  }
  get affectedOnly() {
    return this.page.getByTestId('dicom-upload-affected');
  }
  get retry() {
    return this.page.getByTestId('dicom-upload-retry');
  }
  get close() {
    return this.page.getByTestId('dicom-upload-close');
  }
  get cancelAll() {
    return this.page.getByTestId('dicom-upload-cancel-all');
  }
  row(name: string) {
    return this.rows.filter({ hasText: name });
  }
  async showTechnicalDetails() {
    for (const detail of await this.results.getByTestId('dicom-upload-details').all()) {
      await detail.click();
    }
    await this.results.evaluate(element => {
      element.scrollTop = 0;
    });
  }
  async dropFolder(unreadable = false) {
    // Inject an unreadable/empty directory entry, keeping the real React drop handler.
    await this.dropzone.evaluate((element, unreadable) => {
      const event = new Event('drop', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'dataTransfer', {
        value: {
          types: ['Files'],
          items: [
            {
              kind: 'file',
              webkitGetAsEntry: () => ({
                isDirectory: true,
                createReader: () => ({
                  readEntries: (resolve, reject) =>
                    unreadable
                      ? reject(new DOMException('Demo folder cannot be read', 'NotReadableError'))
                      : resolve([]),
                }),
              }),
            },
          ],
        },
      });
      element.dispatchEvent(event);
    }, unreadable);
  }
}
