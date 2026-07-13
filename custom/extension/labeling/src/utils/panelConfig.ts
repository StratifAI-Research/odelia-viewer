import type Config from './config';
import type { PanelConfig } from './config';

/**
 * Returns the panel_configs entry with the given name, throwing if none matches.
 *
 * Shared by PanelLabeling, PanelLeisons, and importCSVReport.
 *
 * NB: lives in its own module (not config.ts) because the labeling webpack
 * resolve order puts `.json` before `.ts`, so a runtime import of
 * `../utils/config` would resolve to config.json — this keeps config.ts
 * type-only and collision-free.
 */
export function getPanelConfig(config: Config, name: string): PanelConfig {
  const panel = config.panel_configs.find(panel => panel.name === name);
  if (!panel) {
    throw new Error(`No panel_config named "${name}"`);
  }
  return panel;
}
