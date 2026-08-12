import { useEffect } from 'react';
import { useAIViewportStore } from '../stores/useAIViewportStore';
import { AIOverlayHookConfig } from '../types/overlayTypes';

/**
 * Publishes a viewport's AI state so the pieces OHIF renders inside the
 * cornerstone viewport can pick it up: the `viewportOverlay.topLeft` item
 * (the AI summary) and the `viewportActionMenu.topRight` button (the heatmap
 * toggle).
 *
 * Before OHIF 3.13 this hook built those elements itself and pushed them into
 * `viewportActionCornersService`. That service is gone — corners are toolbar
 * sections now — so the hook only publishes state and lets the registered
 * components render themselves.
 *
 * Heatmap viewports publish nothing: they exist to display a heatmap and must
 * not grow their own AI summary or a nested toggle.
 */
export const useAIOverlay = ({
  viewportId,
  aiResult,
  isHeatmapViewport,
  isHeatmapActive = false,
  onToggleHeatmap = null,
}: AIOverlayHookConfig): void => {
  const setViewportAIState = useAIViewportStore(store => store.setViewportAIState);
  const clearViewportAIState = useAIViewportStore(store => store.clearViewportAIState);

  useEffect(() => {
    if (isHeatmapViewport) {
      clearViewportAIState(viewportId);
      return;
    }

    setViewportAIState(viewportId, {
      aiResult: aiResult ?? null,
      hasHeatmap: !!aiResult?.hasHeatmap,
      isHeatmapActive,
      onToggleHeatmap,
    });
  }, [
    viewportId,
    aiResult,
    isHeatmapViewport,
    isHeatmapActive,
    onToggleHeatmap,
    setViewportAIState,
    clearViewportAIState,
  ]);

  // Drop the entry when the viewport goes away, so a recycled viewport id can
  // never inherit the previous occupant's AI result.
  useEffect(() => {
    return () => clearViewportAIState(viewportId);
  }, [viewportId, clearViewportAIState]);
};
