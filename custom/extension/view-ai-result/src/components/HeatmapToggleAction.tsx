import React from 'react';
import { Icons, ToolButton } from '@ohif/ui-next';
import { useViewportAIState } from '../stores/useAIViewportStore';

/**
 * Action-corner entry that opens / closes the heatmap for a viewport.
 *
 * Rendered by OHIF's `Toolbar` inside `viewportActionMenu.topRight`, which
 * hands every button the `viewportId` it belongs to — that id is what links
 * this button back to the viewport's AI state. The button renders nothing
 * until the viewport publishes a result, so viewports without AI output keep
 * the stock corner contents.
 *
 * `ToolButton` is the same component the stock corner tools use, so the
 * hover/toggled/disabled treatment and the tooltip match the rest of the
 * viewport chrome instead of being hand-rolled.
 */
export function HeatmapToggleAction({ viewportId }: { viewportId?: string }) {
  const aiState = useViewportAIState(viewportId ?? '');

  if (!aiState?.aiResult) {
    return null;
  }

  const { hasHeatmap, isHeatmapActive, onToggleHeatmap } = aiState;
  const disabled = !hasHeatmap || !onToggleHeatmap;

  return (
    <ToolButton
      id="ai-heatmap-toggle"
      size="small"
      label="Heatmap"
      tooltip={isHeatmapActive ? 'Hide the AI heatmap' : 'Show the AI heatmap'}
      isToggled={isHeatmapActive && !disabled}
      disabled={disabled}
      disabledText="No heatmap available for this AI result"
      onInteraction={() => onToggleHeatmap?.()}
    >
      <Icons.ToolFusionColor className="h-6 w-6" />
    </ToolButton>
  );
}

export default HeatmapToggleAction;
