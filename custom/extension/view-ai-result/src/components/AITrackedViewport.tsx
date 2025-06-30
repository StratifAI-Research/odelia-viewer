import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { AISideBySideViewportProps } from '../types';
import { useAIResult } from '../hooks/useAIResult';
import { useViewportElement } from '../hooks/useViewportElement';
import { useAIOverlay } from '../hooks/useAIOverlay';
import { useAIResultSubscription } from '../hooks/useAIResultSubscription';
import { HeatmapLayoutManager, getPrimaryDisplaySets } from '../utils';
import HeatmapToggle from './HeatmapToggle';

const AITrackedViewport = ({
  viewportId,
  servicesManager,
  extensionManager,
  commandsManager,
  displaySets = [],
  viewportOptions = {},
  ...props
}: AISideBySideViewportProps) => {
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

    if (currentAIResult) {
      HeatmapLayoutManager.toggleHeatmapLayout(newShowHeatmap, {
        viewportId,
        displaySets: primaryDisplaySets, // Use filtered primary display sets
        viewportOptions: enhancedViewportOptions, // Use memoized options
        aiResult: currentAIResult,
        viewportGridService: servicesManager.services.viewportGridService,
      });
    }
  }, [showHeatmap, currentAIResult, viewportId, primaryDisplaySets, enhancedViewportOptions, servicesManager.services.viewportGridService, isHeatmapViewport]);

  // Handle AI result selection from events - SIMPLE STATE UPDATE ONLY
  const handleAIResultSelected = useCallback((newSelectedAIResult) => {
    console.log(`[AITrackedViewport] AI result selected for ${viewportId}:`, newSelectedAIResult);

    // Just update state - React will handle the rerender naturally!
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
    }
  }, [viewportId, isHeatmapViewport, updateOverlay, setupHeatmapActionCorner, handleHeatmapToggle]);

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

  // EXACT PATTERN FROM TrackedCornerstoneViewport
  const getCornerstoneViewport = () => {
    const { component: Component } = extensionManager.getModuleEntry(
      '@ohif/extension-cornerstone.viewportModule.cornerstone'
    );

    return (
      <Component
        {...props}
        displaySets={viewportDisplaySets}
        viewportOptions={enhancedViewportOptions}
        servicesManager={servicesManager}
        extensionManager={extensionManager}
        commandsManager={commandsManager}
        onElementEnabled={evt => {
          props.onElementEnabled?.(evt);
          onElementEnabled(evt);
        }}
        onElementDisabled={onElementDisabled}
      />
    );
  };

  return (
    <div className="relative flex h-full w-full flex-row overflow-hidden">
      {getCornerstoneViewport()}

      {/* Heatmap toggle button - only show on primary viewport with heatmap available */}
      {currentAIResult?.hasHeatmap && !isHeatmapViewport && (
        <div className="absolute top-2 right-2 z-10">
          <HeatmapToggle
            onToggle={handleHeatmapToggle}
            isActive={showHeatmap}
            className="shadow-md"
          />
        </div>
      )}
    </div>
  );
};

export default AITrackedViewport;
