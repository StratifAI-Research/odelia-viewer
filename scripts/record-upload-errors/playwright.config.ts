import { defineConfig } from '@playwright/test';
import path from 'node:path';

const output =
  process.env.UPLOAD_DEMO_OUTPUT || path.resolve(__dirname, '../../outputs/upload-errors-demo');
export default defineConfig({
  testDir: __dirname,
  testMatch: 'upload-errors.spec.ts',
  outputDir: path.join(output, process.env.DEMO_FAST ? 'dry-run' : 'recording'),
  timeout: 240_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://127.0.0.1:3347',
    launchOptions: { executablePath: process.env.UPLOAD_DEMO_CHROMIUM },
    viewport: { width: 1280, height: 1000 },
    video: { mode: 'on', size: { width: 1280, height: 1000 } },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    testIdAttribute: 'data-cy',
    actionTimeout: 10_000,
  },
  webServer: {
    command: 'node serve.cjs',
    url: 'http://127.0.0.1:3347',
    reuseExistingServer: true,
  },
});
