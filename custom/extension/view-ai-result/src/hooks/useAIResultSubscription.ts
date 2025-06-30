import { useEffect, useCallback } from 'react';
import { AIResult } from '../types';

interface AIResultSubscriptionConfig {
  viewportId: string;
  isHeatmapViewport: boolean;
  servicesManager: any;
  onAIResultSelected: (aiResult: AIResult) => void;
  onHeatmapToggle?: () => void;
  showHeatmap?: boolean;
}

export const useAIResultSubscription = (config: AIResultSubscriptionConfig) => {
  const {
    viewportId,
    isHeatmapViewport,
    servicesManager,
    onAIResultSelected,
    onHeatmapToggle,
    showHeatmap = false
  } = config;

  const { aiResultsService } = servicesManager.services;

  const handleAIResultSelected = useCallback((eventData: any) => {
    console.log(`[useAIResultSubscription] AI result selected for ${viewportId}:`, eventData);

    if (eventData?.aiResult && !isHeatmapViewport) {
      onAIResultSelected(eventData.aiResult);
    }
  }, [viewportId, isHeatmapViewport, onAIResultSelected]);

  useEffect(() => {
    if (!aiResultsService || isHeatmapViewport) {
      console.log(`[useAIResultSubscription] Skipping subscription for ${viewportId}: ${!aiResultsService ? 'no service' : 'heatmap viewport'}`);
      return;
    }

    console.log(`[useAIResultSubscription] Setting up subscription for ${viewportId}`);

    const subscription = aiResultsService.subscribe(
      aiResultsService.EVENTS.AI_RESULT_SELECTED,
      handleAIResultSelected
    );

    // Cleanup function
    return () => {
      console.log(`[useAIResultSubscription] Cleaning up subscription for ${viewportId}`);
      subscription.unsubscribe();
    };
  }, [
    aiResultsService,
    viewportId,
    isHeatmapViewport,
    handleAIResultSelected
  ]);
};
