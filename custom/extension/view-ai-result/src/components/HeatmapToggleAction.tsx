import React from 'react';
import HeatmapToggle from './HeatmapToggle';
import { useViewportAIState } from '../stores/useAIViewportStore';

/**
 * Action-corner entry that opens / closes the heatmap for a viewport.
 *
 * Rendered by OHIF's `Toolbar` inside `viewportActionMenu.topRight`, which
 * hands every button the `viewportId` it belongs to — that id is what links
 * this button back to the viewport's AI state. The button renders nothing
 * until the viewport publishes a result, so viewports without AI output keep
 * the stock corner contents.
 */
export function HeatmapToggleAction({ viewportId }: { viewportId?: string }) {
  const aiState = useViewportAIState(viewportId ?? '');

  if (!aiState?.aiResult) {
    return null;
  }

  const { hasHeatmap, isHeatmapActive, onToggleHeatmap } = aiState;
  const disabled = !hasHeatmap || !onToggleHeatmap;
  const toggle = () => !disabled && onToggleHeatmap?.();
  const title = disabled
    ? 'No heatmap available for this AI result'
    : isHeatmapActive
      ? 'Hide heatmap'
      : 'Show heatmap';

  // The icon and the label each carry their own handler — a handler on the
  // wrapper as well would fire twice for a click on the icon (once directly,
  // once from the bubbled button click) and cancel itself out.
  return (
    <div
      className="flex items-center gap-1 text-xs"
      title={title}
      data-cy="ai-heatmap-toggle"
    >
      <HeatmapToggle
        onToggle={toggle}
        isActive={isHeatmapActive && !disabled}
        className="h-6 w-6 shadow-none"
        disabled={disabled}
      />
      <span
        className={
          disabled ? 'cursor-not-allowed select-none text-gray-500' : 'cursor-pointer select-none'
        }
        onClick={disabled ? undefined : toggle}
      >
        {disabled ? '🔥 No Heatmap' : isHeatmapActive ? '🔥 Heatmap ON' : '🔥 Heatmap Available'}
      </span>
    </div>
  );
}

export default HeatmapToggleAction;
