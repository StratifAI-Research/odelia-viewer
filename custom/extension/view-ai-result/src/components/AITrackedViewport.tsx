import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { AISideBySideViewportProps } from '../types';
import { useAIResult } from '../hooks/useAIResult';
import { useViewportElement } from '../hooks/useViewportElement';
import { useAIOverlay } from '../hooks/useAIOverlay';
import { useAIResultSubscription } from '../hooks/useAIResultSubscription';
import { HeatmapLayoutManager, renderCornerstoneViewport, getPrimaryDisplaySets } from '../utils';

/**
 * Compose an optional external callback with our own (always-present) internal
 * one, returning a single function that invokes the external first, then the
 * internal. (an external onElementEnabled/Disabled must run alongside our
 * own rather than clobber it or be clobbered by prop-spread order.)
 */
function composeCallbacks<T extends (...args: any[]) => void>(
  external: T | undefined,
  internal: T
): (...args: Parameters<T>) => void {
  if (!external) {
    return internal;
  }
  return (...args: Parameters<T>) => {
    external(...args);
    internal(...args);
  };
}

const AITrackedViewportInner = ({
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
  const isHeatmapViewport =
    viewportId.includes('-heatmap') || displaySets.some(ds => ds.Modality === 'SC');

  const [showHeatmap, setShowHeatmap] = useState(false);
  // Selected AI result, tagged with the primary content it belongs to.
  const [selectedAIResult, setSelectedAIResult] = useState(null);
  const [selectionKey, setSelectionKey] = useState<string | null>(null);

  // Get initial AI result (for default state)
  const initialAIResult = useAIResult(displaySets, servicesManager);

  // Filter to only primary imaging display sets for initial viewport
  const primaryDisplaySets = getPrimaryDisplaySets(displaySets);

  // Identity of the viewport's primary imaging content (excludes SR/SC), so a
  // selection is tied to the study, not to a specific AI result within it.
  const primaryDisplaySetKey = primaryDisplaySets.map(ds => ds.displaySetInstanceUID).join('|');

  // Ignore a selection once the primary content changes, so it can't carry into
  // another study.
  const activeSelectedAIResult = selectionKey === primaryDisplaySetKey ? selectedAIResult : null;
  const currentAIResult = activeSelectedAIResult || initialAIResult;

  const { onElementEnabled, onElementDisabled } = useViewportElement();

  // AI Overlay management - only for primary viewports
  const overlayConfig = {
    viewportId,
    aiResult: currentAIResult,
    isHeatmapViewport,
    servicesManager,
  };
  const { updateOverlay, setupHeatmapActionCorner } = useAIOverlay(overlayConfig);

  // Use appropriate display sets based on viewport type
  const viewportDisplaySets = isHeatmapViewport ? displaySets : primaryDisplaySets;

  // Memoize enhanced viewport options to prevent cascade rerenders
  const enhancedViewportOptions = useMemo(
    () => ({
      // Default to a stack viewport. This is NOT a stability guarantee —
      // when a heatmap is toggled on, heatmapLayoutManager forces 'volume', which
      // does remount the viewport. (`viewportOptions` below can also override it.)
      viewportType: 'stack',
      showOverlays: !isHeatmapViewport,
      ...viewportOptions,
    }),
    [viewportOptions, isHeatmapViewport]
  );

  // Apply the heatmap layout for an explicitly passed result, so callers can act
  // on a selection before it is committed to state.
  const applyHeatmapLayout = useCallback(
    (show: boolean, aiResult) => {
      if (isHeatmapViewport) {
        return;
      } // Never drive layout from a heatmap viewport
      if (show && !aiResult?.hasHeatmap) {
        return;
      } // Nothing to open

      HeatmapLayoutManager.toggleHeatmapLayout(show, {
        viewportId,
        displaySets: primaryDisplaySets, // Use filtered primary display sets
        viewportOptions: enhancedViewportOptions, // Use memoized options
        aiResult,
        viewportGridService,
        servicesManager,
      });
    },
    [
      isHeatmapViewport,
      viewportId,
      primaryDisplaySets,
      enhancedViewportOptions,
      viewportGridService,
      servicesManager,
    ]
  );

  // Handle heatmap toggle (only for primary viewports)
  const handleHeatmapToggle = useCallback(() => {
    if (isHeatmapViewport) {
      return;
    } // Don't handle toggle on heatmap viewport

    // Don't allow toggle if no heatmap is available
    if (!currentAIResult?.hasHeatmap) {
      return;
    }

    const newShowHeatmap = !showHeatmap;
    setShowHeatmap(newShowHeatmap);

    // Update the action corner toggle button state
    setupHeatmapActionCorner(
      currentAIResult,
      handleHeatmapToggle,
      newShowHeatmap,
      currentAIResult.hasHeatmap
    );

    applyHeatmapLayout(newShowHeatmap, currentAIResult);
  }, [
    showHeatmap,
    currentAIResult,
    isHeatmapViewport,
    setupHeatmapActionCorner,
    applyHeatmapLayout,
  ]);

  // Handle AI result selection from events
  const handleAIResultSelected = useCallback(
    (newSelectedAIResult, clickedDisplaySetUID: string) => {
      setSelectedAIResult(newSelectedAIResult);
      setSelectionKey(primaryDisplaySetKey);

      // Update overlay (only for primary viewports)
      if (!isHeatmapViewport) {
        updateOverlay(newSelectedAIResult);
      }

      // Close the heatmap belonging to the outgoing result (currentAIResult).
      if (showHeatmap && !isHeatmapViewport && currentAIResult) {
        setShowHeatmap(false);
        applyHeatmapLayout(false, currentAIResult);
      }

      if (!isHeatmapViewport && newSelectedAIResult) {
        // Auto-open the heatmap when the click landed on this result's own SC
        // thumbnail. Use newSelectedAIResult explicitly, not handleHeatmapToggle
        // (its currentAIResult is not yet committed).
        const shouldAutoOpen =
          newSelectedAIResult.hasHeatmap &&
          newSelectedAIResult.heatmapDisplaySet?.displaySetInstanceUID === clickedDisplaySetUID &&
          !showHeatmap;

        setupHeatmapActionCorner(
          newSelectedAIResult,
          handleHeatmapToggle,
          shouldAutoOpen,
          newSelectedAIResult.hasHeatmap
        );

        if (shouldAutoOpen) {
          setShowHeatmap(true);
          applyHeatmapLayout(true, newSelectedAIResult);
        }
      }
    },
    [
      isHeatmapViewport,
      updateOverlay,
      setupHeatmapActionCorner,
      handleHeatmapToggle,
      showHeatmap,
      currentAIResult,
      applyHeatmapLayout,
      primaryDisplaySetKey,
    ]
  );

  // Subscribe to AI result selection events
  useAIResultSubscription({
    viewportId,
    isHeatmapViewport,
    servicesManager,
    onAIResultSelected: handleAIResultSelected,
  });

  // Reset the heatmap toggle when the primary content changes.
  useEffect(() => {
    setShowHeatmap(false);
  }, [primaryDisplaySetKey]);

  // Ensure heatmap toggle action corner is in sync
  useEffect(() => {
    if (!isHeatmapViewport && currentAIResult) {
      setupHeatmapActionCorner(
        currentAIResult,
        handleHeatmapToggle,
        showHeatmap,
        currentAIResult.hasHeatmap
      );
    }
  }, [
    currentAIResult,
    showHeatmap,
    isHeatmapViewport,
    setupHeatmapActionCorner,
    handleHeatmapToggle,
  ]);

  return (
    <div className="relative flex h-full w-full flex-row overflow-hidden">
      {renderCornerstoneViewport({
        // Spread incoming props FIRST so our computed values win, and
        // compose the element callbacks so an external onElementEnabled/Disabled
        // (if the host passes one) runs alongside our own instead of clobbering
        // — or being clobbered by — it.
        ...props,
        viewportId,
        displaySets: viewportDisplaySets, // Use appropriate display sets based on viewport type
        viewportOptions: enhancedViewportOptions, // Use memoized options
        // NO needsRerendering prop here - let OHIF handle it through setDisplaySetsForViewports
        extensionManager,
        servicesManager,
        commandsManager,
        onElementEnabled: composeCallbacks((props as any).onElementEnabled, onElementEnabled),
        onElementDisabled: composeCallbacks((props as any).onElementDisabled, onElementDisabled),
      })}

      {/* Heatmap toggle is now injected via ViewportActionCornersService for better alignment */}
    </div>
  );
};

/**
 * Prop comparator for the memoized viewport, closely modeled on OHIF's base
 * `OHIFCornerstoneViewport` `areEqual`
 * (extensions/cornerstone/src/Viewport/OHIFCornerstoneViewport.tsx).
 *
 * Why a custom comparator: the OHIF ViewportGrid re-renders on every
 * interaction and passes freshly-built `displaySets`/`viewportOptions` objects and
 * a new inline `onElementEnabled` closure each time, so React.memo's DEFAULT shallow
 * compare never skips — it would re-run every AI hook/effect on every grid frame
 * (the "20 renders/sec" viewer-rendering-loop gotcha). We re-render only on OHIF's
 * stable-contract signals plus this wrapper's own semantic inputs.
 *
 * `needsRerendering` note: this flag is OHIF's forced-rerender escape hatch, but it
 * is dormant in this repo — nothing sets `displaySet.needsRerendering` or
 * `viewportOptions.needsRerendering` to true (verified across platform/, extensions/,
 * custom/ and @ohif/core; the only assignment is the base viewport CLEARING it). We
 * honor the top-level prop to match OHIF's contract and stay future-proof, and
 * intentionally ignore `viewportOptions.needsRerendering`: renderCornerstoneViewport
 * hands the base viewport a COPIED options object, and the base clears the flag only
 * on its own copy — so keying off the grid's original could re-render us on every
 * grid frame. Nested needsRerendering is handled at the base layer, on the object it
 * actually receives.
 *
 * Exported for unit testing.
 */
export function areEqual(
  prevProps: AISideBySideViewportProps,
  nextProps: AISideBySideViewportProps
) {
  if (nextProps.needsRerendering) {
    return false;
  }

  if (prevProps.viewportId !== nextProps.viewportId) {
    return false;
  }

  const prevOpts = prevProps.viewportOptions || {};
  const nextOpts = nextProps.viewportOptions || {};
  if (prevOpts.orientation !== nextOpts.orientation) {
    return false;
  }
  if (prevOpts.toolGroupId !== nextOpts.toolGroupId) {
    return false;
  }
  if (nextOpts.viewportType && prevOpts.viewportType !== nextOpts.viewportType) {
    return false;
  }

  const prevDS = prevProps.displaySets || [];
  const nextDS = nextProps.displaySets || [];
  if (prevDS.length !== nextDS.length) {
    return false;
  }

  for (let i = 0; i < prevDS.length; i++) {
    const prev = prevDS[i];
    const next = nextDS[i];

    if (prev.displaySetInstanceUID !== next.displaySetInstanceUID) {
      return false;
    }
    // Wrapper semantics: heatmap detection keys off Modality; AI-result selection
    // keys off StudyInstanceUID. Cheap primitive compares, defensive against a
    // replacement display set that reuses a UID. (In-place mutation of a shared
    // object is undetectable here — same limitation as OHIF's base comparator —
    // and remains the needsRerendering escape hatch's responsibility.)
    if (prev.Modality !== next.Modality) {
      return false;
    }
    if (prev.StudyInstanceUID !== next.StudyInstanceUID) {
      return false;
    }
    // Per-image identity (mirrors OHIF) — catches same-length image-list changes.
    if (prev.images?.length !== next.images?.length) {
      return false;
    }
    if (prev.images?.length) {
      for (let j = 0; j < prev.images.length; j++) {
        if (prev.images[j].imageId !== next.images[j].imageId) {
          return false;
        }
      }
    }
  }

  return true; // effectively equal — skip re-render
}

export default React.memo(AITrackedViewportInner, areEqual);
