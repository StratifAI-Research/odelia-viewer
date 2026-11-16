import { defineConfig } from '@playwright/test';
import path from 'node:path';

const output = process.env.UPLOAD_CHECK_OUTPUT;
if (!output) throw new Error('Set UPLOAD_CHECK_OUTPUT to the prepared local dataset directory.');
export default defineConfig({
  testDir: __dirname,
  testMatch: 'downloads-upload.spec.ts',
  outputDir: path.join(output, 'playwright'),
  timeout: 600_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3347',
    launchOptions: { executablePath: process.env.UPLOAD_DEMO_CHROMIUM },
    viewport: { width: 1440, height: 1000 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    testIdAttribute: 'data-cy',
    actionTimeout: 15_000,
  },
  webServer: {
    command: 'node ../record-upload-errors/serve.cjs',
    url: 'http://127.0.0.1:3347',
    reuseExistingServer: true,
  },
});
