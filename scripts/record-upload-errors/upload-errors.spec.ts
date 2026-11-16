import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '../../tests/utils';
import { dicomBytes } from '../../extensions/cornerstone/src/utils/testUtils/dicomUploadFixtures';

const output =
  process.env.UPLOAD_DEMO_OUTPUT || path.resolve(__dirname, '../../outputs/upload-errors-demo');
const fast = Boolean(process.env.DEMO_FAST);
const file = (name: string, buffer: Buffer | string) => ({
  name,
  mimeType: 'application/octet-stream',
  buffer: Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer),
});
const dicom = (id: string, name = `${id}.dcm`, sopClass?: string) =>
  file(name, Buffer.concat([Buffer.from(dicomBytes(sopClass)), Buffer.from(`DEMO_CASE_${id};`)]));
const nifti = Buffer.alloc(352);
nifti.writeInt32LE(348, 0);
nifti.write('n+1\0', 344, 'binary');
const failure = (code: number) => ({
  '00081198': { vr: 'SQ', Value: [{ '00081197': { vr: 'US', Value: [code] } }] },
});
const warning = (code: number) => ({
  '00081199': { vr: 'SQ', Value: [{ '00081196': { vr: 'US', Value: [code] } }] },
});

test('record all upload error explanations', async ({ page, DOMOverlayPageObject }, testInfo) => {
  fs.mkdirSync(output, { recursive: true });
  const upload = DOMOverlayPageObject.dialog.dicomUpload;
  const browserErrors: string[] = [];
  page.on('pageerror', error => browserErrors.push(error.message));
  let retryFixed = false;
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
        defaultDataSourceName: 'demo',
        dataSources: [
          {
            namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
            sourceName: 'demo',
            configuration: {
              friendlyName: 'Upload demo — simulated server',
              name: 'demo',
              qidoRoot: '/demo-dicomweb',
              wadoRoot: '/demo-dicomweb',
              wadoUriRoot: '/demo-dicomweb',
              imageRendering: 'wadors',
              thumbnailRendering: 'wadors',
              dicomUploadEnabled: true,
              qidoSupportsIncludeField: true,
              supportsFuzzyMatching: false,
            },
          },
        ],
      })}; window.config.httpErrorHandler = () => {};`,
    })
  );
  await page.route('**/demo-dicomweb/**', async route => {
    const request = route.request();
    if (request.method() !== 'POST') {
      await route.fulfill({ json: [] });
      return;
    }
    const id = request
      .postDataBuffer()
      ?.toString('latin1')
      .match(/DEMO_CASE_([\w-]+);/)?.[1];
    if (id === 'cancel' || id === 'timeout-event') return;
    if (id === 'network') {
      await route.abort('connectionfailed');
      return;
    }
    if (id === 'retry') {
      await route.fulfill({ status: retryFixed ? 200 : 503, json: {} });
      return;
    }
    if (id?.startsWith('http-')) {
      await route.fulfill({ status: Number(id.slice(5)), json: {} });
      return;
    }
    if (id?.startsWith('dicom-')) {
      await route.fulfill({ status: 409, json: failure(parseInt(id.slice(6), 16)) });
      return;
    }
    if (id?.startsWith('warning-')) {
      await route.fulfill({ status: 202, json: warning(parseInt(id.slice(8), 16)) });
      return;
    }
    if (id === 'unconfirmed') {
      await route.fulfill({ status: 202, json: {} });
      return;
    }
    await route.fulfill({ json: {} });
  });
  // Browser faults cannot be produced by HTTP fixtures. Scope fault injection to named demo files.
  await page.addInitScript(() => {
    const nativeSlice = File.prototype.slice;
    File.prototype.slice = function (...args) {
      const blob = nativeSlice.apply(this, args);
      if (this.name === 'unreadable-file.dcm')
        Object.defineProperty(blob, '__demoUnreadable', { value: true });
      return blob;
    };
    const nativeRead = FileReader.prototype.readAsArrayBuffer;
    FileReader.prototype.readAsArrayBuffer = function (blob) {
      if ((blob as any).__demoUnreadable) {
        Object.defineProperty(this, 'error', {
          value: new DOMException('Simulated read failure', 'NotReadableError'),
        });
        queueMicrotask(() => this.dispatchEvent(new Event('error')));
        return;
      }
      nativeRead.call(this, blob);
    };
    const nativeSend = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.send = function (body) {
      if (body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
        const text = new TextDecoder().decode(body as ArrayBuffer);
        if (text.includes('DEMO_CASE_generic;'))
          throw new Error('Simulated unexpected upload failure');
        if (text.includes('DEMO_CASE_timeout-event;')) this.timeout = 200;
      }
      nativeSend.call(this, body);
    };
  });

  await page.goto('/', { waitUntil: 'domcontentloaded' });
  await expect(upload.openButton).toBeVisible({ timeout: 45_000 });
  const started = Date.now();
  const chapters: { title: string; seconds: number }[] = [];
  const title = async (text: string) => {
    chapters.push({ title: text, seconds: (Date.now() - started) / 1000 });
    await page.evaluate(text => {
      let banner = document.getElementById('upload-demo-caption');
      if (!banner) {
        banner = document.createElement('div');
        banner.id = 'upload-demo-caption';
        banner.style.cssText =
          'position:fixed;inset:0 0 auto 0;z-index:2147483647;padding:13px 24px;background:#101827;color:#e5edf8;font:600 18px system-ui;pointer-events:none;border-bottom:2px solid #38bdf8;display:flex;justify-content:space-between;gap:20px';
        document.body.appendChild(banner);
      }
      banner.replaceChildren();
      const heading = document.createElement('span');
      heading.textContent = text;
      const badge = document.createElement('span');
      badge.textContent = 'DEMO · synthetic files / simulated responses';
      badge.style.cssText = 'font:12px system-ui;color:#94a3b8;align-self:center';
      banner.append(heading, badge);
    }, text);
  };
  // These pauses pace the recording for reading; assertions above/below synchronize with the app.
  const hold = async (ms = 6000) => {
    if (!fast) await page.waitForTimeout(ms);
  };
  const snapshot = async (name: string) => {
    await upload.results.screenshot({ path: path.join(output, `${name}.png`) });
  };
  const begin = async (heading: string, files: ReturnType<typeof file>[]) => {
    await title(heading);
    if (!(await upload.files.isVisible())) await upload.openButton.click();
    await upload.files.setInputFiles(files);
    await expect(upload.summary).toContainText('Upload finished');
    await expect(upload.rows).toHaveCount(files.length);
    await upload.showTechnicalDetails();
  };
  const verifyRowsVisible = async () => {
    const bounds = await upload.results.boundingBox();
    for (const row of await upload.rows.all()) {
      const box = await row.boundingBox();
      expect(box.y + box.height).toBeLessThanOrEqual(bounds.y + bounds.height + 2);
    }
  };
  const finish = async (name: string, ms = 6000) => {
    await verifyRowsVisible();
    await snapshot(name);
    await hold(ms);
    await upload.close.click();
  };

  await title('DICOM uploads: clear reasons and next steps');
  await upload.openButton.click();
  await expect(upload.dropzone).toContainText('DICOM files only');
  await hold(2500);
  await title('Folder selection: empty folder');
  await upload.dropFolder();
  await expect(upload.selectionError).toContainText('No readable files');
  await hold(3000);
  await title('Folder selection: folder cannot be read');
  await upload.dropFolder(true);
  await expect(upload.selectionError).toContainText('Could not read the selected files or folder');
  await hold(3500);

  await title('Mixed folder: DICOM uploads; NIfTI, NRRD and MetaImage are skipped');
  const mixed = path.join(output, 'synthetic-files', 'mixed-folder');
  fs.mkdirSync(mixed, { recursive: true });
  for (const fixture of [
    dicom('success', '01-original-dicom'),
    file('02-brain.nii', nifti),
    file('03-brain.nii.gz', Buffer.from([0x1f, 0x8b])),
    file('04-brain.nrrd', 'NRRD0005'),
    file('05-brain.mha', 'ObjectType = Image'),
  ]) {
    fs.writeFileSync(path.join(mixed, fixture.name), fixture.buffer);
  }
  await upload.folder.setInputFiles(mixed);
  await expect(upload.summary).toContainText('1 uploaded · 4 skipped · 0 failed');
  await expect(upload.row('01-original-dicom')).toContainText('Uploaded');
  await finish('01-mixed-folder', 7500);

  await begin('Unsupported images and documents: PNG, JPEG, PDF', [
    file('image.png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])),
    file('image.jpg', Buffer.from([255, 216, 255])),
    file('report.pdf', '%PDF-1.7'),
  ]);
  await expect(upload.summary).toContainText('0 uploaded · 3 skipped');
  await expect(upload.row('image.png')).toContainText('DICOM files only');
  await finish('02-images', 6000);

  await begin('Archives and unrecognized files: extract or choose a DICOM export', [
    file('archive.zip', Buffer.from([80, 75, 3, 4])),
    file('archive-by-name.zip', 'archive'),
    file('unrecognized.dcm', 'not DICOM'),
  ]);
  await expect(upload.row('archive.zip')).toContainText('Extract the archive');
  await expect(upload.row('unrecognized.dcm')).toContainText('Could not recognize');
  await finish('03-archives', 6000);

  await begin('Auxiliary files: directory indexes and system metadata', [
    dicom('index', 'DICOMDIR', '1.2.840.10008.1.3.10'),
    file('.DS_Store', 'metadata'),
    file('Thumbs.db', 'metadata'),
  ]);
  await expect(upload.row('DICOMDIR')).toContainText('directory index');
  await finish('04-auxiliary', 5000);

  await begin('Local failures: empty file, unreadable file, unexpected error', [
    file('empty.dcm', ''),
    dicom('read', 'unreadable-file.dcm'),
    dicom('generic', 'unexpected-error.dcm'),
  ]);
  await expect(upload.row('empty.dcm')).toContainText('This file is empty');
  await expect(upload.row('unreadable-file.dcm')).toContainText('Could not read this file');
  await expect(upload.row('unexpected-error.dcm')).toContainText(
    'The upload could not be completed'
  );
  await finish('05-local-errors', 6500);

  await begin('Server access: sign-in, permission, service address', [
    dicom('http-401'),
    dicom('http-403'),
    dicom('http-404'),
  ]);
  await expect(upload.row('http-401')).toContainText('Sign in again');
  await expect(upload.row('http-403')).toContainText('permission');
  await expect(upload.row('http-404')).toContainText('could not be found');
  await finish('06-access', 6000);

  await begin('Server limits: oversized file and unsupported upload format', [
    dicom('http-413'),
    dicom('http-415'),
  ]);
  await expect(upload.row('http-413')).toContainText('upload limit');
  await finish('07-limits', 5000);

  await begin('Server rejection: bad request or conflict', [dicom('http-400'), dicom('http-409')]);
  await expect(upload.row('http-409')).toContainText('invalid or unsupported DICOM data');
  await finish('08-rejected', 5000);

  await begin('Connection errors and timeouts: check whether the file was stored', [
    dicom('network'),
    dicom('timeout-event'),
    dicom('http-504'),
  ]);
  await expect(upload.row('network')).toContainText('Could not confirm');
  await expect(upload.row('timeout-event')).toContainText('timed out');
  await finish('09-network', 6500);

  await begin('Temporary failures: too many requests or server unavailable', [
    dicom('http-429'),
    dicom('http-500'),
    dicom('http-503'),
  ]);
  await expect(upload.row('http-429')).toContainText('Wait a moment');
  await finish('10-server', 6000);

  await begin('DICOM rejection: unsupported encoding or object type', [
    dicom('dicom-C122'),
    dicom('dicom-0122'),
  ]);
  await expect(upload.row('dicom-C122')).toContainText('transfer syntax');
  await expect(upload.row('dicom-0122')).toContainText('SOP class');
  await finish('11-dicom-unsupported', 6000);

  await begin('DICOM rejection: inconsistent or unreadable data', [
    dicom('dicom-A900'),
    dicom('dicom-C001'),
  ]);
  await expect(upload.row('dicom-A900')).toContainText('declared object type');
  await expect(upload.row('dicom-C001')).toContainText('could not read the DICOM data');
  await finish('12-dicom-data', 5500);

  await begin('Storage failures: insufficient resources, processing, other rejection', [
    dicom('dicom-A700'),
    dicom('dicom-0110'),
    dicom('dicom-FFFF'),
  ]);
  await expect(upload.row('dicom-A700')).toContainText('enough resources');
  await finish('13-storage', 6500);

  await begin('Stored with warnings: metadata changed, discarded, or inconsistent', [
    dicom('warning-B000'),
    dicom('warning-B006'),
    dicom('warning-B007'),
  ]);
  await expect(upload.summary).toContainText('3 need review');
  await finish('14-warnings', 6500);

  await begin('Needs review: other warnings or storage not confirmed', [
    dicom('warning-B123'),
    dicom('unconfirmed'),
  ]);
  await expect(upload.row('unconfirmed')).toContainText('Storage could not be fully confirmed');
  await finish('15-unconfirmed', 6000);

  await begin('Recovery: show affected files and retry only failures', [
    dicom('success', 'already-uploaded.dcm'),
    dicom('retry', 'retry-this-file.dcm'),
  ]);
  await expect(upload.summary).toContainText('1 uploaded · 0 skipped · 1 failed');
  await upload.affectedOnly.check();
  await expect(upload.rows).toHaveCount(1);
  await hold(2500);
  retryFixed = true;
  await upload.retry.click();
  await expect(upload.summary).toContainText('2 uploaded · 0 skipped · 0 failed');
  await title('Retry succeeded — previously uploaded files were not sent again');
  // Show all results after successful recovery.
  await upload.affectedOnly.click();
  await expect(upload.rows).toHaveCount(2);
  await upload.results.evaluate(element => {
    element.scrollTop = 0;
  });
  await hold(2500);
  await upload.close.click();

  await title('Cancellation is reported separately from errors');
  await upload.openButton.click();
  await upload.files.setInputFiles([dicom('cancel', 'cancel-upload.dcm')]);
  await expect(upload.row('cancel-upload.dcm')).toContainText('Uploading');
  await hold(2000);
  await upload.cancelAll.click();
  await expect(upload.summary).toContainText('1 cancelled');
  await snapshot('16-cancelled');
  await hold(3500);

  fs.writeFileSync(
    path.join(output, fast ? 'dry-run-chapters.json' : 'chapters.json'),
    JSON.stringify(
      {
        synthetic: true,
        durationSeconds: (Date.now() - started) / 1000,
        chapters,
        browserErrors,
      },
      null,
      2
    )
  );
  expect(browserErrors).toEqual([]);
  await testInfo.attach('scenario-chapters', {
    body: JSON.stringify(chapters),
    contentType: 'application/json',
  });
});
