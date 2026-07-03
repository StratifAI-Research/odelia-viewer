import type Config from './config';
import type { PanelConfig } from './config';

/**
 * Returns the panel_configs entry with the given name, or undefined.
 *
 * Replaces the `panel_configs.filter(c => c.name == name)[0]` expression that
 * was duplicated in PanelLabeling, PanelLeisons, and importCSVReport.
 *
 * NB: lives in its own module (not config.ts) because the labeling webpack
 * resolve order puts `.json` before `.ts`, so a runtime import of
 * `../utils/config` would resolve to config.json — this keeps config.ts
 * type-only and collision-free.
 */
export function getPanelConfig(config: Config, name: string): PanelConfig {
  // Mirrors the original `.filter(...)[0]` (returns undefined if no match, but
  // typed PanelConfig to match the previous call-site typing exactly).
  return config.panel_configs.filter(panel => panel.name === name)[0];
}
