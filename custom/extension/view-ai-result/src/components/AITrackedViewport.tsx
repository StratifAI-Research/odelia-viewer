import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { AISideBySideViewportProps } from '../types';
import { useAIResult } from '../hooks/useAIResult';
import { useViewportElement } from '../hooks/useViewportElement';
import { useAIOverlay } from '../hooks/useAIOverlay';
import { useAIResultSubscription } from '../hooks/useAIResultSubscription';
import { HeatmapLayoutManager, renderCornerstoneViewport, getPrimaryDisplaySets } from '../utils';

const AITrackedViewport = ({
  viewportId,
  servicesManager,
  extensionManager,
  commandsManager,
  displaySets = [],
  viewportOptions = {},
  ...props
}: AISideBySideViewportProps) => {
    const { viewportGridService } = servicesManager.services;

  // Detect if this is a heatmap viewport
  const isHeatmapViewport = viewportId.includes('-heatmap') ||
    displaySets.some(ds => ds.Modality === 'SC');

  const [showHeatmap, setShowHeatmap] = useState(false);
  // State for the currently selected AI result (overrides initial AI result)
  const [selectedAIResult, setSelectedAIResult] = useState(null);

  // Get initial AI result (for default state)
  const initialAIResult = useAIResult(displaySets, servicesManager);

  // Use selected AI result if available, otherwise fall back to initial
  const currentAIResult = selectedAIResult || initialAIResult;

  const { onElementEnabled, onElementDisabled } = useViewportElement();

  // AI Overlay management - only for primary viewports
  const overlayConfig = {
    viewportId,
    aiResult: currentAIResult,
    isHeatmapViewport,
    servicesManager
  };
  const { updateOverlay, setupHeatmapActionCorner } = useAIOverlay(overlayConfig);

  // Filter to only primary imaging display sets for initial viewport
  const primaryDisplaySets = getPrimaryDisplaySets(displaySets);

  // Use appropriate display sets based on viewport type
  const viewportDisplaySets = isHeatmapViewport ? displaySets : primaryDisplaySets;

  // Memoize enhanced viewport options to prevent cascade rerenders
  const enhancedViewportOptions = useMemo(() => ({
    ...viewportOptions,
    showOverlays: !isHeatmapViewport, // Only show overlays for primary viewports
  }), [viewportOptions, isHeatmapViewport]);


    // Handle heatmap toggle (only for primary viewports)
  const handleHeatmapToggle = useCallback(() => {
    if (isHeatmapViewport) return; // Don't handle toggle on heatmap viewport

    const newShowHeatmap = !showHeatmap;
    setShowHeatmap(newShowHeatmap);

    // Update the action corner toggle button state
    if (currentAIResult?.hasHeatmap) {
      setupHeatmapActionCorner(currentAIResult, handleHeatmapToggle, newShowHeatmap);
    }

    if (currentAIResult) {
      HeatmapLayoutManager.toggleHeatmapLayout(newShowHeatmap, {
        viewportId,
        displaySets: primaryDisplaySets, // Use filtered primary display sets
        viewportOptions: enhancedViewportOptions, // Use memoized options
        aiResult: currentAIResult,
        viewportGridService,
      });
    }
  }, [showHeatmap, currentAIResult, viewportId, primaryDisplaySets, enhancedViewportOptions, viewportGridService, isHeatmapViewport]);

  // Handle AI result selection from events
  const handleAIResultSelected = useCallback((newSelectedAIResult, clickedDisplaySetUID: string) => {
    console.log(`[AITrackedViewport] AI result selected for ${viewportId}:`, newSelectedAIResult);

    // Update the selected AI result state
    setSelectedAIResult(newSelectedAIResult);

    // Update overlay (only for primary viewports)
    if (!isHeatmapViewport) {
      updateOverlay(newSelectedAIResult);
    }

    // Reset heatmap state when new AI result is selected
    setShowHeatmap(false);

    // Setup heatmap action corner if needed (only for primary viewports)
    if (newSelectedAIResult?.hasHeatmap && !isHeatmapViewport) {
      setupHeatmapActionCorner(newSelectedAIResult, handleHeatmapToggle, false);

      // Auto-enable heatmap if user clicked directly on the heatmap thumbnail (SC)
      if (
        newSelectedAIResult.heatmapDisplaySet?.displaySetInstanceUID === clickedDisplaySetUID &&
        !showHeatmap
      ) {
        handleHeatmapToggle();
      }
    }
  }, [viewportId, isHeatmapViewport, updateOverlay, setupHeatmapActionCorner, handleHeatmapToggle, showHeatmap]);

  // Subscribe to AI result selection events
  useAIResultSubscription({
    viewportId,
    isHeatmapViewport,
    servicesManager,
    onAIResultSelected: handleAIResultSelected,
  });

  // Debug effect to track AI result changes
  useEffect(() => {
    console.log(`[AITrackedViewport] ${viewportId} AI result state:`, {
      hasInitialAIResult: !!initialAIResult,
      hasSelectedAIResult: !!selectedAIResult,
      currentHasHeatmap: currentAIResult?.hasHeatmap,
      showHeatmap,
      isHeatmapViewport,
      shouldShowToggle: currentAIResult?.hasHeatmap && !isHeatmapViewport,
      shouldShowOverlays: !isHeatmapViewport
    });
  }, [viewportId, initialAIResult, selectedAIResult, currentAIResult, showHeatmap, isHeatmapViewport]);

  // Ensure heatmap toggle action corner is in sync
  useEffect(() => {
    if (!isHeatmapViewport && currentAIResult?.hasHeatmap) {
      setupHeatmapActionCorner(currentAIResult, handleHeatmapToggle, showHeatmap);
    }
  }, [currentAIResult, showHeatmap, isHeatmapViewport, setupHeatmapActionCorner, handleHeatmapToggle]);

  return (
    <div className="relative flex h-full w-full flex-row overflow-hidden">
      {renderCornerstoneViewport({
        viewportId,
        displaySets: viewportDisplaySets, // Use appropriate display sets based on viewport type
        viewportOptions: enhancedViewportOptions, // Use memoized options
        // NO needsRerendering prop here - let OHIF handle it through setDisplaySetsForViewports
        extensionManager,
        servicesManager,
        commandsManager,
        onElementEnabled,
        onElementDisabled,
        ...props,
      })}

      {/* Heatmap toggle is now injected via ViewportActionCornersService for better alignment */}
    </div>
  );
};

export default AITrackedViewport;
