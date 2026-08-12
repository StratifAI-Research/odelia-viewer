import { defineConfig } from '@playwright/test';
import base from './playwright.config';

/**
 * CI-only overlay on top of the upstream Playwright config.
 *
 * `playwright.config.ts` is kept byte-identical to upstream so that OHIF merges stay
 * clean; anything specific to *this* fork's runner belongs here instead.
 *
 * Must live at the repository root: Playwright resolves `testDir`, `globalSetup`,
 * `outputDir` and `snapshotPathTemplate` relative to the directory of the config it
 * loaded, so moving this file would silently repoint all of them.
 *
 * actionTimeout: upstream's 10s is calibrated for their self-hosted runner. This fork's
 * CI is a GitHub-hosted container that reports
 *   ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)
 * — a CPU rasteriser (see the "Log the WebGL renderer" step). Software-rendering a 3D
 * volume takes longer than 10s, so clicking a 3D layout preset ('3D only', '3D four up')
 * times out while Playwright waits for the page to go navigation-stable, even though the
 * layout switch itself succeeds. Nothing hangs: the same specs pass unchanged at 15s, 30s
 * and 180s. 45s is ~3x the measured 15s threshold, for headroom on a 4-vCPU runner sharing
 * itself between two workers, the dev server and SwiftShader. Actions that succeed still
 * return immediately, so this costs passing tests nothing.
 */
export default defineConfig(base, {
  use: {
    actionTimeout: 45_000,
  },
});
