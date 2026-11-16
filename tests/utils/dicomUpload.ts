import type { Page } from '@playwright/test';
import { dicomBytes } from '../../extensions/cornerstone/src/utils/testUtils/dicomUploadFixtures';

export const uploadFile = (name: string, content: Buffer | string) => ({
  name,
  mimeType: 'application/octet-stream',
  buffer: Buffer.isBuffer(content) ? content : Buffer.from(content),
});

export const uploadDicom = (id: string) =>
  uploadFile(
    `${id}.dcm`,
    Buffer.concat([Buffer.from(dicomBytes()), Buffer.from(`UPLOAD_CASE_${id};`)])
  );

type Outcome = { status?: number; body?: object; pending?: boolean };

/** Isolated STOW fixtures: no external PACS or patient data is used by these tests. */
export async function setupUploadServer(page: Page) {
  const outcomes = new Map<string, Outcome>();
  const requests: string[] = [];
  await page.route('**/app-config.js', route =>
    route.fulfill({
      contentType: 'application/javascript',
      body: `window.config = ${JSON.stringify({
        routerBasename: '/',
        investigationalUseDialog: { option: 'never' },
        viewerUpdates: { enabled: false },
        showStudyList: true,
        extensions: [],
        modes: [],
        maxNumberOfWebWorkers: 1,
        showWarningMessageForCrossOrigin: false,
        showCPUFallbackMessage: false,
        defaultDataSourceName: 'upload-test',
        dataSources: [
          {
            namespace: '@ohif/extension-default.dataSourcesModule.dicomweb',
            sourceName: 'upload-test',
            configuration: {
              friendlyName: 'Upload test',
              name: 'upload-test',
              qidoRoot: '/upload-test',
              wadoRoot: '/upload-test',
              wadoUriRoot: '/upload-test',
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
  await page.route('**/upload-test/**', async route => {
    if (route.request().method() !== 'POST') {
      await route.fulfill({ json: [] });
      return;
    }
    const id = route
      .request()
      .postDataBuffer()
      ?.toString('latin1')
      .match(/UPLOAD_CASE_([\w-]+);/)?.[1];
    if (!id) throw new Error('Unexpected upload without a synthetic fixture marker.');
    requests.push(id);
    const outcome = outcomes.get(id) || {};
    if (outcome.pending) return;
    await route.fulfill({ status: outcome.status || 200, json: outcome.body || {} });
  });
  return { outcomes, requests };
}
