import { Icons } from '@ohif/ui-next';
import AIModelIcon from './AIModelIcon';

/**
 * Panel-rail icon this extension contributes.
 *
 * The routing panel used ui-next's `clipboard`, which reads as a worklist rather
 * than as "send this study to a model". The name is prefixed because
 * `Icons.addIcon` overwrites — and warns — on a collision, and the registry is
 * shared with upstream and every other extension.
 */
export const ORTHANC_AI_ROUTING_ICONS = {
  'odelia-ai-model': AIModelIcon,
} as const;

/**
 * Register on the shared set. Called from `preRegistration`, which runs before
 * any panel renders. Adding only what is missing keeps a repeated call (hot
 * reload) from logging a "Replacing icon" warning.
 */
export function registerIcons(): void {
  Object.entries(ORTHANC_AI_ROUTING_ICONS).forEach(([name, icon]) => {
    if (!Icons[name]) {
      Icons.addIcon(name, icon);
    }
  });
}

export { AIModelIcon };
