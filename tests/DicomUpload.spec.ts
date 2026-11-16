import fs from 'node:fs';
import path from 'node:path';
import { test as base, expect } from './utils';
import { setupUploadServer, uploadDicom, uploadFile } from './utils/dicomUpload';

const test = base.extend<{ uploadServer: Awaited<ReturnType<typeof setupUploadServer>> }>({
  uploadServer: async ({ page }, use) => {
    await use(await setupUploadServer(page));
  },
});

test.beforeEach(async ({ page, uploadServer, DOMOverlayPageObject }) => {
  // Instantiate the route fixture before navigating.
  expect(uploadServer.requests).toEqual([]);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(DOMOverlayPageObject.dialog.dicomUpload.openButton).toBeVisible({ timeout: 45_000 });
  await DOMOverlayPageObject.dialog.dicomUpload.openButton.click();
});

for (const kind of ['files', 'folders', 'mixed'] as const) {
  test(`uploads multiple dropped ${kind} using native browser drag data`, async ({
    DOMOverlayPageObject,
    uploadServer,
  }, testInfo) => {
    const upload = DOMOverlayPageObject.dialog.dicomUpload;
    const root = testInfo.outputPath('drop-input');
    const paths = ['first', 'second'].map((id, index) => {
      const folder = kind === 'folders' || (kind === 'mixed' && index === 1);
      const directory = folder ? path.join(root, id) : root;
      fs.mkdirSync(directory, { recursive: true });
      const fixture = uploadDicom(id);
      const filePath = path.join(directory, fixture.name);
      fs.writeFileSync(filePath, fixture.buffer);
      return folder ? directory : filePath;
    });
    await upload.dropPaths(paths);
    await expect(upload.summary).toHaveText('Upload finished · 2 uploaded · 0 skipped · 0 failed', {
      timeout: 10_000,
    });
    await expect(upload.row('first.dcm')).toContainText('Uploaded');
    await expect(upload.row('second.dcm')).toContainText('Uploaded');
    expect(uploadServer.requests.sort()).toEqual(['first', 'second']);
  });
}

test('explains unsupported and empty files while uploading DICOM', async ({
  DOMOverlayPageObject,
  uploadServer,
}) => {
  const upload = DOMOverlayPageObject.dialog.dicomUpload;
  await upload.files.setInputFiles([
    uploadDicom('valid'),
    uploadFile('brain.nii.gz', Buffer.from([0x1f, 0x8b])),
    uploadFile('archive.zip', Buffer.from([80, 75, 3, 4])),
    uploadFile('empty.dcm', ''),
  ]);
  await expect(upload.summary).toHaveText('Upload finished · 1 uploaded · 2 skipped · 1 failed');
  await expect(upload.row('brain.nii.gz')).toContainText('NIfTI');
  await expect(upload.row('archive.zip')).toContainText('Extract the archive');
  await expect(upload.row('empty.dcm')).toContainText('This file is empty');
  await expect(upload.retry).toBeHidden();
  await upload.affectedOnly.check();
  await expect(upload.rows).toHaveCount(3);
  await expect(upload.row('valid.dcm')).toHaveCount(0);
  expect(uploadServer.requests).toEqual(['valid']);
});

test('explains forbidden uploads without offering retry', async ({
  DOMOverlayPageObject,
  uploadServer,
}) => {
  uploadServer.outcomes.set('forbidden', { status: 403 });
  const upload = DOMOverlayPageObject.dialog.dicomUpload;
  await upload.files.setInputFiles(uploadDicom('forbidden'));
  await expect(upload.summary).toHaveText('Upload finished · 0 uploaded · 0 skipped · 1 failed');
  await expect(upload.row('forbidden.dcm')).toContainText('Contact your administrator');
  await expect(upload.retry).toBeHidden();
  expect(uploadServer.requests).toEqual(['forbidden']);
});

test('distinguishes DICOM rejection, storage warnings and unconfirmed storage', async ({
  DOMOverlayPageObject,
  uploadServer,
}) => {
  uploadServer.outcomes.set('rejected', {
    status: 409,
    body: { '00081198': { Value: [{ '00081197': { Value: [0xc122] } }] } },
  });
  uploadServer.outcomes.set('warning', {
    status: 202,
    body: { '00081199': { Value: [{ '00081196': { Value: [0xb006] } }] } },
  });
  uploadServer.outcomes.set('unconfirmed', { status: 202 });
  const upload = DOMOverlayPageObject.dialog.dicomUpload;
  await upload.files.setInputFiles(['rejected', 'warning', 'unconfirmed'].map(uploadDicom));
  await expect(upload.summary).toHaveText(
    'Upload finished · 0 uploaded · 0 skipped · 1 failed · 2 need review'
  );
  await expect(upload.row('rejected.dcm')).toContainText('transfer syntax');
  await expect(upload.row('warning.dcm')).toContainText('Needs review');
  await expect(upload.row('warning.dcm')).toContainText('discarded');
  await expect(upload.row('unconfirmed.dcm')).toContainText('Storage could not be fully confirmed');
  await expect(upload.retry).toBeHidden();
});

test('retries transient failures without repeating successful or forbidden uploads', async ({
  DOMOverlayPageObject,
  uploadServer,
}) => {
  uploadServer.outcomes.set('transient', { status: 503 });
  uploadServer.outcomes.set('forbidden', { status: 403 });
  const upload = DOMOverlayPageObject.dialog.dicomUpload;
  await upload.files.setInputFiles(['successful', 'transient', 'forbidden'].map(uploadDicom));
  await expect(upload.summary).toHaveText('Upload finished · 1 uploaded · 0 skipped · 2 failed');
  await upload.affectedOnly.check();
  await expect(upload.rows).toHaveCount(2);
  uploadServer.outcomes.set('transient', { status: 200 });
  await upload.retry.click();
  await expect(upload.summary).toHaveText('Upload finished · 2 uploaded · 0 skipped · 1 failed');
  await expect(upload.rows).toHaveCount(1);
  await expect(upload.row('forbidden.dcm')).toBeVisible();
  await expect(upload.retry).toBeHidden();
  expect(uploadServer.requests.filter(id => id === 'successful')).toHaveLength(1);
  expect(uploadServer.requests.filter(id => id === 'forbidden')).toHaveLength(1);
  expect(uploadServer.requests.filter(id => id === 'transient')).toHaveLength(2);
});

test('cancels active and queued uploads without counting them as failures', async ({
  DOMOverlayPageObject,
  uploadServer,
}) => {
  const ids = ['one', 'two', 'three', 'four', 'five'];
  ids.forEach(id => uploadServer.outcomes.set(id, { pending: true }));
  const upload = DOMOverlayPageObject.dialog.dicomUpload;
  await upload.files.setInputFiles(ids.map(uploadDicom));
  await expect.poll(() => uploadServer.requests.length).toBe(3);
  await expect(upload.row('four.dcm')).toContainText('Queued');
  await upload.cancelAll.click();
  await expect(upload.summary).toHaveText(
    'Upload finished · 0 uploaded · 0 skipped · 0 failed · 5 cancelled'
  );
  for (const id of ids) await expect(upload.row(`${id}.dcm`)).toContainText('Cancelled');
  expect(uploadServer.requests).toHaveLength(3);
  await expect(upload.retry).toBeHidden();
  await upload.close.click();
  await expect(upload.openButton).toBeVisible();
});
