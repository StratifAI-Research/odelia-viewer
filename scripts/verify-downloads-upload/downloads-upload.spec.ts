import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../../tests/utils';

const output = process.env.UPLOAD_CHECK_OUTPUT!;
const orthanc = 'http://127.0.0.1:18047';
const datasets = JSON.parse(fs.readFileSync(path.join(output, 'manifest.json'), 'utf8'));

test('upload actual ODELIA and RV folders to local Orthanc', async ({
  page,
  request,
  DOMOverlayPageObject,
}) => {
  const upload = DOMOverlayPageObject.dialog.dicomUpload;
  const browserErrors: string[] = [];
  const responses: number[] = [];
  const report: object[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  // Configuration only is replaced. Every DICOMweb request reaches real local Orthanc.
  await page.route('**/app-config.js', route =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.config = ${JSON.stringify({
        routerBasename: '/',
        investigationalUseDialog: { option: 'never' },
        showStudyList: true,
        extensions: [],
        modes: [],
        maxNumberOfWebWorkers: 1,
        showWarningMessageForCrossOrigin: false,
        showCPUFallbackMessage: false,
        defaultDataSourceName: 'local-check',
        dataSources: [
          {
            namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
            sourceName: 'local-check',
            configuration: {
              friendlyName: 'Local upload verification',
              name: 'local-check',
              qidoRoot: '/local-dicomweb',
              wadoRoot: '/local-dicomweb',
              wadoUriRoot: '/local-dicomweb',
              imageRendering: 'wadors',
              thumbnailRendering: 'wadors',
              dicomUploadEnabled: true,
              qidoSupportsIncludeField: true,
              supportsFuzzyMatching: false,
            },
          },
        ],
      })};`,
    })
  );
  await page.route('**/local-dicomweb/**', async route => {
    const url = new URL(route.request().url());
    const response = await route.fetch({
      url: orthanc + url.pathname.replace('/local-dicomweb', '/dicom-web') + url.search,
      timeout: 120_000,
    });
    if (route.request().method() === 'POST') responses.push(response.status());
    await route.fulfill({ response });
  });
  // Ensure aggregate counts cannot be satisfied by instances from earlier runs.
  expect(await (await request.get(`${orthanc}/instances`)).json()).toEqual([]);
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(upload.openButton).toBeVisible({ timeout: 45_000 });

  // Original ZIP selections must explain extraction, without sending anything to PACS.
  await upload.openButton.click();
  await upload.files.setInputFiles(datasets.map(dataset => dataset.archive));
  await expect(upload.summary).toHaveText('Upload finished · 0 uploaded · 3 skipped · 0 failed');
  for (const dataset of datasets) {
    await expect(upload.row(path.basename(dataset.archive))).toContainText('Extract the archive');
  }
  expect(responses).toHaveLength(0);
  await upload.results.screenshot({ path: path.join(output, 'zip-extraction-message.png') });
  await upload.close.click();

  for (const dataset of datasets) {
    const dicom = dataset.files.filter(file => file.kind === 'dicom');
    const skipped = dataset.files.filter(file => file.kind !== 'dicom');
    const before = responses.length;
    const started = Date.now();
    await upload.openButton.click();
    await upload.folder.setInputFiles(dataset.folder);
    await expect(upload.summary).toHaveText(
      `Upload finished · ${dicom.length} uploaded · ${skipped.length} skipped · 0 failed`,
      { timeout: 480_000 }
    );
    expect(responses.length - before).toBe(dicom.length);
    expect(responses.slice(before).every(status => status === 200)).toBe(true);
    await expect(upload.rows).toHaveCount(dataset.files.length);
    await upload.summary.screenshot({ path: path.join(output, `${dataset.name}-summary.png`) });
    if (skipped.length) {
      await upload.affectedOnly.check();
      await expect(upload.rows).toHaveCount(skipped.length);
      for (const file of skipped) {
        await expect(upload.row(file.relative)).toContainText(
          file.kind === 'nifti' ? 'NIfTI' : 'Could not recognize this as a supported DICOM file'
        );
      }
      await upload.results.screenshot({ path: path.join(output, `${dataset.name}-skipped.png`) });
    }
    report.push({
      dataset: dataset.name,
      dicom: dicom.length,
      skipped: skipped.length,
      series: new Set(dicom.map(file => file.series)).size,
      seconds: (Date.now() - started) / 1000,
      summary: await upload.summary.innerText(),
    });
    fs.writeFileSync(
      path.join(output, 'browser-results.json'),
      JSON.stringify({ report, browserErrors, responses }, null, 2)
    );
    console.log(JSON.stringify(report[report.length - 1]));
    await upload.close.click();
  }
  const stored = await (await request.get(`${orthanc}/instances?expand`)).json();
  const expected = datasets.flatMap(dataset =>
    dataset.files.filter(file => file.kind === 'dicom').map(file => file.sop)
  );
  expect(stored.map(instance => instance.MainDicomTags.SOPInstanceUID).sort()).toEqual(
    expected.sort()
  );
  expect(browserErrors).toEqual([]);
  fs.writeFileSync(
    path.join(output, 'stored-instances.json'),
    JSON.stringify(
      stored.map(instance => ({
        id: instance.ID,
        sop: instance.MainDicomTags.SOPInstanceUID,
      })),
      null,
      2
    )
  );
});
