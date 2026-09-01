import { Icons } from '@ohif/ui-next';
import AIChatIcon from './AIChatIcon';
import AIFeedbackIcon from './AIFeedbackIcon';
import ChatHistoryIcon from './ChatHistoryIcon';

/**
 * Panel-rail icons this extension contributes.
 *
 * ui-next's set has no chat or annotation glyph, so the panels used to borrow
 * whatever was closest: the AI Chat tab showed `tab-patient-info` (a patient
 * card with a pencil) and Feedback showed `tab-linear` (the linear *measurement*
 * tool). Neither says what its panel does.
 *
 * Names are prefixed because `Icons.addIcon` overwrites — and warns — on a
 * collision, and this registry is shared with upstream and every other
 * extension.
 */
export const VIEW_AI_RESULT_ICONS = {
  'odelia-ai-chat': AIChatIcon,
  'odelia-ai-feedback': AIFeedbackIcon,
  'odelia-chat-history': ChatHistoryIcon,
} as const;

/**
 * Register them on the shared set. Called from `preRegistration`, which runs
 * before any panel renders. Adding only what is missing keeps a repeated call
 * (hot reload) from logging a "Replacing icon" warning per icon.
 */
export function registerIcons(): void {
  Object.entries(VIEW_AI_RESULT_ICONS).forEach(([name, icon]) => {
    if (!Icons[name]) {
      Icons.addIcon(name, icon);
    }
  });
}

export { AIChatIcon, AIFeedbackIcon, ChatHistoryIcon };
