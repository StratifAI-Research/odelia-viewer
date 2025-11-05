import React, { useCallback, useEffect, useRef } from 'react';
import HeatmapToggle from '../components/HeatmapToggle';
import { AIOverlayHookConfig, AIOverlayHookReturn } from '../types/overlayTypes';
import { AIResult } from '../types';
import AIClassificationOverlay from '../components/overlays/AIClassificationOverlay';

export const useAIOverlay = (config: AIOverlayHookConfig): AIOverlayHookReturn => {
  const { viewportId, aiResult, isHeatmapViewport, servicesManager } = config;
  const {
    viewportActionCornersService,
    customizationService
  } = servicesManager.services;

  // Keep track of current overlay state
  const currentOverlayRef = useRef<string | null>(null);

  // AGGRESSIVELY clear default OHIF overlays that show underneath our AI overlays
  const clearDefaultOHIFOverlays = useCallback(() => {
    customizationService.setCustomizations({
      'viewportOverlay.topLeft': { $set: [] },
      'viewportOverlay.topRight': { $set: [] },
      'viewportOverlay.bottomLeft': { $set: [] },
      'viewportOverlay.bottomRight': { $set: [] }
    });
    console.log(`[useAIOverlay] NUKED all default OHIF overlays for viewport ${viewportId}`);
  }, [customizationService, viewportId]);

    const updateOverlay = useCallback((newAiResult: AIResult) => {
    // Only update overlays on primary viewports, not heatmap viewports
    if (isHeatmapViewport) {
      console.log(`[useAIOverlay] Skipping overlay update for heatmap viewport ${viewportId}`);
      return;
    }

    // AGGRESSIVELY NUKE default OHIF overlays first - they show underneath and cause clutter!
    clearDefaultOHIFOverlays();

            // Create a SINGLE container that fights ViewportActionCorners' horizontal flexbox!
    // Use flex-col to override the horizontal layout

    const leftBreast = newAiResult.classifications?.find(c => c.side === 'Left');
    const rightBreast = newAiResult.classifications?.find(c => c.side === 'Right');

    // Build the text content strings first
    const leftBreastText = leftBreast ? (
      leftBreast.errorMessage ? leftBreast.errorMessage :
      `${leftBreast.isMalignant ? 'Malignant' : 'Benign'} (${leftBreast.confidence ? leftBreast.confidence.toFixed(1) : '--'}%)`
    ) : '--';

    const rightBreastText = rightBreast ? (
      rightBreast.errorMessage ? rightBreast.errorMessage :
      `${rightBreast.isMalignant ? 'Malignant' : 'Benign'} (${rightBreast.confidence ? rightBreast.confidence.toFixed(1) : '--'}%)`
    ) : '--';

        // Create container with flex-col that overrides ViewportActionCorners horizontal layout
    const aiOverlayContainer = React.createElement('div', {
      className: 'flex flex-col gap-0.5 text-[10px] leading-tight max-w-[120px]',
      style: { textShadow: '0.8px 0.8px 0.5px rgba(0, 0, 0, 0.75)' }
    }, [
      // Header line - beautiful blue styling
      React.createElement('div', {
        key: 'header',
        className: 'font-semibold text-blue-300'
      }, `🤖 ${newAiResult.modelInfo?.name || 'AI Model'}`),

      // Left breast line - same beautiful styling as header
      React.createElement('div', {
        key: 'left',
        className: 'font-semibold text-blue-300'
      }, `Left Breast: ${leftBreastText}`),

      // Right breast line - same beautiful styling as header
      React.createElement('div', {
        key: 'right',
        className: 'font-semibold text-blue-300'
      }, `Right Breast: ${rightBreastText}`)
    ]);

    // Add as SINGLE action corner component with internal vertical layout
    viewportActionCornersService.addComponent({
      viewportId,
      id: 'aiOverlay',
      component: aiOverlayContainer,
      location: viewportActionCornersService.LOCATIONS.topLeft,
      indexPriority: -200, // Higher priority than default
    });

    currentOverlayRef.current = 'aiOverlay';
    console.log(`[useAIOverlay] Updated AI overlay container with internal flex-col layout for primary viewport ${viewportId}`);
  }, [viewportId, isHeatmapViewport, viewportActionCornersService]);

  const clearOverlay = useCallback(() => {
    // Only clear overlays on primary viewports
    if (isHeatmapViewport) {
      console.log(`[useAIOverlay] Skipping overlay clear for heatmap viewport ${viewportId}`);
      return;
    }

    // Clear the single AI overlay container
    viewportActionCornersService.addComponent({
      viewportId,
      id: 'aiOverlay',
      component: null,
      location: viewportActionCornersService.LOCATIONS.topLeft,
    });

    currentOverlayRef.current = null;
    console.log(`[useAIOverlay] Cleared AI overlay container for primary viewport ${viewportId}`);
  }, [viewportId, isHeatmapViewport, viewportActionCornersService]);

  const setupHeatmapActionCorner = useCallback((result: AIResult, onToggle: () => void, isActive: boolean, hasHeatmap: boolean = true) => {
    // Only setup action corners on primary viewports
    if (isHeatmapViewport) {
      console.log(`[useAIOverlay] Skipping action corner setup for heatmap viewport ${viewportId}`);
      return;
    }

    // Determine if button should be disabled
    const isDisabled = !hasHeatmap;

    // Create a row with the heat-map icon button and a small label
    const toggleComponent = React.createElement('div', {
      className: `flex items-center gap-1 ${isDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'}`,
      onClick: isDisabled ? undefined : onToggle,
      title: isDisabled ? 'No heatmap available for this AI result' : (isActive ? 'Hide heatmap' : 'Show heatmap'),
      style: { fontSize: '12px' }
    }, [
      React.createElement(HeatmapToggle, {
        key: 'btn',
        onToggle: isDisabled ? () => {} : onToggle,
        isActive: isActive && !isDisabled,
        className: 'shadow-none w-6 h-6',
        disabled: isDisabled,
      }),
      React.createElement('span', {
        key: 'lbl',
        className: `select-none ${isDisabled ? 'text-gray-500' : 'text-white'}`
      }, isDisabled ? '🔥 No Heatmap' : (isActive ? '🔥 Heatmap ON' : '🔥 Heatmap Available'))
    ]);

    viewportActionCornersService.addComponent({
      viewportId,
      id: 'heatmapToggle',
      component: toggleComponent,
      location: viewportActionCornersService.LOCATIONS.topRight,
      indexPriority: -100, // High priority
    });

    console.log(`[useAIOverlay] Setup heatmap action corner for primary viewport ${viewportId} (disabled: ${isDisabled})`);
  }, [viewportId, isHeatmapViewport, viewportActionCornersService]);

  const clearActionCorners = useCallback(() => {
    // Only clear on primary viewports
    if (isHeatmapViewport) {
      console.log(`[useAIOverlay] Skipping action corner clear for heatmap viewport ${viewportId}`);
      return;
    }

    // Clear specific action corner components instead of entire viewport
    viewportActionCornersService.addComponent({
      viewportId,
      id: 'heatmapToggle',
      component: null,
      location: viewportActionCornersService.LOCATIONS.topRight,
    });

    console.log(`[useAIOverlay] Cleared heatmap action corner for primary viewport ${viewportId}`);
  }, [viewportId, isHeatmapViewport, viewportActionCornersService]);

  // Update overlay when aiResult changes (only for primary viewports) - SINGLE EFFECT
  useEffect(() => {
    // NEVER show overlays on heatmap viewports - they're for displaying heatmaps only!
    if (isHeatmapViewport) {
      console.log(`[useAIOverlay] BLOCKING overlay for heatmap viewport ${viewportId}`);
      // Aggressively clear any overlays that might have been added
      viewportActionCornersService.addComponent({
        viewportId,
        id: 'aiOverlay',
        component: null,
        location: viewportActionCornersService.LOCATIONS.topLeft,
      });
      return;
    }

    if (aiResult) {
      updateOverlay(aiResult);
    } else {
      // Clear overlay if no AI result
      clearOverlay();
    }
  }, [aiResult, isHeatmapViewport, updateOverlay, clearOverlay, viewportId, viewportActionCornersService]);

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
