import React, { useCallback, useEffect, useRef } from 'react';
import { AIOverlayHookConfig, AIOverlayHookReturn } from '../types/overlayTypes';
import { AIResult } from '../types';
import {
  createAIClassificationOverlay,
  createDefaultAIOverlay,
  applyOverlayCustomization
} from '../utils/overlayFactory';

export const useAIOverlay = (config: AIOverlayHookConfig): AIOverlayHookReturn => {
  const { viewportId, aiResult, isHeatmapViewport, servicesManager } = config;
  const {
    customizationService,
    viewportActionCornersService
  } = servicesManager.services;

  // Keep track of current overlay state
  const currentOverlayRef = useRef<string | null>(null);

  const updateOverlay = useCallback((newAiResult: AIResult) => {
    // Only update overlays on primary viewports, not heatmap viewports
    if (isHeatmapViewport) {
      console.log(`[useAIOverlay] Skipping overlay update for heatmap viewport ${viewportId}`);
      return;
    }

    const overlay = createAIClassificationOverlay(newAiResult);
    applyOverlayCustomization(customizationService, overlay);
    currentOverlayRef.current = overlay.id;

    console.log(`[useAIOverlay] Updated overlay for primary viewport ${viewportId}:`, overlay.id);
  }, [viewportId, isHeatmapViewport, customizationService]);

  const clearOverlay = useCallback(() => {
    // Only clear overlays on primary viewports
    if (isHeatmapViewport) {
      console.log(`[useAIOverlay] Skipping overlay clear for heatmap viewport ${viewportId}`);
      return;
    }

    applyOverlayCustomization(customizationService, null);
    currentOverlayRef.current = null;

    console.log(`[useAIOverlay] Cleared overlay for primary viewport ${viewportId}`);
  }, [viewportId, isHeatmapViewport, customizationService]);

  const setupHeatmapActionCorner = useCallback((aiResult: AIResult, onToggle: () => void, isActive: boolean) => {
    // Only setup action corners on primary viewports
    if (isHeatmapViewport || !aiResult?.hasHeatmap) {
      console.log(`[useAIOverlay] Skipping heatmap action corner setup for ${isHeatmapViewport ? 'heatmap' : 'non-heatmap'} viewport ${viewportId}`);
      return;
    }

    // Create component function to avoid JSX in object literal
    const HeatmapActionComponent = () => (
      React.createElement('div', { className: 'flex items-center gap-2' },
        React.createElement('span', { className: 'text-primary-light text-sm' }, 'Heatmap Available'),
        React.createElement('button', {
          onClick: onToggle,
          className: `px-2 py-1 rounded text-xs ${isActive ? 'bg-blue-500 text-white' : 'bg-gray-600 text-gray-200'}`
        }, isActive ? 'Hide' : 'Show', ' Heatmap')
      )
    );

    const component = {
      viewportId,
      id: 'HeatmapToggle',
      component: React.createElement(HeatmapActionComponent),
      location: viewportActionCornersService.LOCATIONS?.topRight || 'topRight',
      indexPriority: 0
    };

    viewportActionCornersService.clear(viewportId);
    viewportActionCornersService.addComponents([component]);

    console.log(`[useAIOverlay] Setup heatmap action corner for primary viewport ${viewportId}`);
  }, [viewportId, isHeatmapViewport, viewportActionCornersService]);

  const clearActionCorners = useCallback(() => {
    // Only clear action corners on primary viewports
    if (isHeatmapViewport) {
      console.log(`[useAIOverlay] Skipping action corner clear for heatmap viewport ${viewportId}`);
      return;
    }

    viewportActionCornersService.clear(viewportId);
    console.log(`[useAIOverlay] Cleared action corners for primary viewport ${viewportId}`);
  }, [viewportId, isHeatmapViewport, viewportActionCornersService]);

  // Initialize default overlay on mount for primary viewports only
  useEffect(() => {
    if (!isHeatmapViewport && !aiResult) {
      const defaultOverlay = createDefaultAIOverlay();
      applyOverlayCustomization(customizationService, defaultOverlay);
      currentOverlayRef.current = defaultOverlay.id;
      console.log(`[useAIOverlay] Initialized default overlay for primary viewport ${viewportId}`);
    } else if (isHeatmapViewport) {
      console.log(`[useAIOverlay] Skipping default overlay initialization for heatmap viewport ${viewportId}`);
    }
  }, [viewportId, isHeatmapViewport, aiResult, customizationService]);

  // Update overlay when aiResult changes (only for primary viewports)
  useEffect(() => {
    if (aiResult && !isHeatmapViewport) {
      updateOverlay(aiResult);
    } else if (isHeatmapViewport) {
      console.log(`[useAIOverlay] Skipping overlay update for heatmap viewport ${viewportId} with aiResult:`, !!aiResult);
    }
  }, [aiResult, isHeatmapViewport, updateOverlay, viewportId]);

  // Cleanup on unmount (only for primary viewports)
  useEffect(() => {
    return () => {
      if (!isHeatmapViewport) {
        clearOverlay();
        clearActionCorners();
        console.log(`[useAIOverlay] Cleanup completed for primary viewport ${viewportId}`);
      } else {
        console.log(`[useAIOverlay] Skipping cleanup for heatmap viewport ${viewportId}`);
      }
    };
  }, [viewportId, isHeatmapViewport, clearOverlay, clearActionCorners]);

  return {
    updateOverlay,
    clearOverlay,
    setupHeatmapActionCorner,
    clearActionCorners
  };
};
