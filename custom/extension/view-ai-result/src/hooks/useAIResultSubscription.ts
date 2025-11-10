import { useEffect, useCallback } from 'react';
import { AIResult } from '../types';

interface AIResultSubscriptionConfig {
  viewportId: string;
  isHeatmapViewport: boolean;
  servicesManager: any;
  onAIResultSelected: (aiResult: AIResult, clickedDisplaySetUID: string) => void;
  onAIResultCleared?: (eventData: any) => void;
  onStudyChanged?: (eventData: any) => void;
  onHeatmapToggle?: () => void;
  showHeatmap?: boolean;
}

export const useAIResultSubscription = (config: AIResultSubscriptionConfig): void => {
  const {
    viewportId,
    isHeatmapViewport,
    servicesManager,
    onAIResultSelected,
    onAIResultCleared,
    onStudyChanged,
    onHeatmapToggle,
    showHeatmap = false
  } = config;

  const { aiResultsService } = servicesManager.services;

  const handleAIResultSelected = useCallback((eventData: any) => {
    console.log(`[useAIResultSubscription] AI result selected for ${viewportId}:`, eventData);

    if (eventData?.aiResult && !isHeatmapViewport) {
      const clickedUID = eventData.clickedDisplaySetInstanceUID ?? eventData.displaySetInstanceUID;
      onAIResultSelected(eventData.aiResult, clickedUID);
    }
  }, [viewportId, isHeatmapViewport, onAIResultSelected]);

  const handleAIResultCleared = useCallback((eventData: any) => {
    console.log(`[useAIResultSubscription] AI result cleared for ${viewportId}:`, eventData);

    if (!isHeatmapViewport && onAIResultCleared) {
      onAIResultCleared(eventData);
    }
  }, [viewportId, isHeatmapViewport, onAIResultCleared]);

  const handleStudyChanged = useCallback((eventData: any) => {
    console.log(`[useAIResultSubscription] Study changed for ${viewportId}:`, eventData);

    if (!isHeatmapViewport && onStudyChanged) {
      onStudyChanged(eventData);
    }
  }, [viewportId, isHeatmapViewport, onStudyChanged]);

  useEffect(() => {
    if (!aiResultsService || isHeatmapViewport) {
      console.log(`[useAIResultSubscription] Skipping subscription for ${viewportId}: ${!aiResultsService ? 'no service' : 'heatmap viewport'}`);
      return;
    }

    console.log(`[useAIResultSubscription] Setting up subscriptions for ${viewportId}`);

    const selectedSubscription = aiResultsService.subscribe(
      aiResultsService.EVENTS.AI_RESULT_SELECTED,
      handleAIResultSelected
    );

    const clearedSubscription = aiResultsService.subscribe(
      aiResultsService.EVENTS.AI_RESULT_CLEARED,
      handleAIResultCleared
    );

    // Cleanup function
    return () => {
      console.log(`[useAIResultSubscription] Cleaning up subscriptions for ${viewportId}`);
      selectedSubscription.unsubscribe();
      clearedSubscription.unsubscribe();
    };
  }, [
    aiResultsService,
    viewportId,
    isHeatmapViewport,
    handleAIResultSelected,
    handleAIResultCleared
  ]);
};
