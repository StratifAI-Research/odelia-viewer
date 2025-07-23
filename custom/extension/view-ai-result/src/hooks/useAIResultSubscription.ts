import { useEffect, useCallback, useRef } from 'react';
import { AIResult } from '../types';

interface AIResultSubscriptionConfig {
  viewportId: string;
  isHeatmapViewport: boolean;
  servicesManager: any;
  onAIResultSelected: (aiResult: AIResult, clickedDisplaySetUID: string) => void;
  onHeatmapToggle?: () => void;
  showHeatmap?: boolean;
}

export const useAIResultSubscription = (config: AIResultSubscriptionConfig): void => {
  const {
    viewportId,
    isHeatmapViewport,
    servicesManager,
    onAIResultSelected,
    onHeatmapToggle,
    showHeatmap = false
  } = config;

  const { aiResultsService } = servicesManager.services;

  /**
   * Store the latest callback in a ref so we don’t need it in the dependency
   * array – prevents effect churn when the parent recreates the function on
   * every render.
   */
  const latestOnAIResultSelected = useRef(onAIResultSelected);
  latestOnAIResultSelected.current = onAIResultSelected;

  // Stable handler that never changes identity unless viewportId/heatmap flag changes
  const stableHandleAIResultSelected = useCallback((eventData: any) => {
    console.log(`[useAIResultSubscription] AI result selected for ${viewportId}:`, eventData);

    if (eventData?.aiResult && !isHeatmapViewport) {
      const clickedUID = eventData.clickedDisplaySetInstanceUID ?? eventData.displaySetInstanceUID;
      // Call the latest version of the callback passed from the parent
      latestOnAIResultSelected.current(eventData.aiResult, clickedUID);
    }
  }, [viewportId, isHeatmapViewport]);

  useEffect(() => {
    if (!aiResultsService || isHeatmapViewport) {
      console.log(`[useAIResultSubscription] Skipping subscription for ${viewportId}: ${!aiResultsService ? 'no service' : 'heatmap viewport'}`);
      return;
    }

    console.log(`[useAIResultSubscription] Setting up subscription for ${viewportId}`);

    const subscription = aiResultsService.subscribe(
      aiResultsService.EVENTS.AI_RESULT_SELECTED,
      stableHandleAIResultSelected
    );

    // Cleanup function
    return () => {
      console.log(`[useAIResultSubscription] Cleaning up subscription for ${viewportId}`);
      subscription.unsubscribe();
    };
  }, [aiResultsService, viewportId, isHeatmapViewport, stableHandleAIResultSelected]);
};
