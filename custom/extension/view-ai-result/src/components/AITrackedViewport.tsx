import React, { useEffect, useState, useCallback, useRef } from 'react';
import { useViewportGrid } from '@ohif/ui-next';
import { AIResult, AISideBySideViewportProps } from '../types';
import { getAIResults } from '../services/mockAIResults';
import HeatmapToggle from './HeatmapToggle';
import AIResultsSelector from './AIResultsSelector';

const AITrackedViewport = ({
  viewportId,
  servicesManager,
  extensionManager,
  commandsManager,
  displaySets = [],
  viewportOptions = {},
  ...props
}: AISideBySideViewportProps) => {
  const {
    cornerstoneViewportService,
    customizationService,
    viewportActionCornersService,
    viewportGridService,
  } = servicesManager.services;

  // Get the first display set for the main viewport
  const displaySet = displaySets[0];
  const [aiResult, setAIResult] = useState<AIResult | null>(null);
  const [showHeatmap, setShowHeatmap] = useState(false);
  const [viewportElem, setViewportElem] = useState(null);

  const [viewportGrid] = useViewportGrid();
  const { activeViewportId } = viewportGrid;

  const isUpdatingRef = useRef(false);

  // Add state for current AI result index
  const [currentResultIndex, setCurrentResultIndex] = useState(0);

  // Handle AI result change
  const handleAIResultChange = useCallback((direction: 'next' | 'prev') => {
    if (!aiResult?.classifications) return;

    const newIndex = direction === 'next'
      ? (currentResultIndex + 1) % aiResult.classifications.length
      : (currentResultIndex - 1 + aiResult.classifications.length) % aiResult.classifications.length;

    setCurrentResultIndex(newIndex);
  }, [currentResultIndex, aiResult?.classifications]);

  // Effect for fetching AI results
  useEffect(() => {
    if (displaySet?.StudyInstanceUID) {
      const result = getAIResults(displaySet.StudyInstanceUID, servicesManager);
      setAIResult(result);
    }
  }, [displaySet, servicesManager]);

  // Effect for setting up viewport element
  const onElementEnabled = useCallback(evt => {
    if (evt.detail.element !== viewportElem) {
      setViewportElem(evt.detail.element);
    }
  }, [viewportElem]);

  const onElementDisabled = useCallback(() => {
    setViewportElem(null);
  }, []);

  // Effect for handling heatmap toggle
  const handleHeatmapToggle = useCallback(() => {
    if (isUpdatingRef.current) return;
    isUpdatingRef.current = true;

    console.log('handleHeatmapToggle called', {
      showHeatmap,
      hasHeatmap: aiResult?.hasHeatmap,
      viewportId,
      currentState: viewportGridService.getState()
    });

    if (!aiResult?.hasHeatmap || !aiResult.heatmapDisplaySet) {
      isUpdatingRef.current = false;
      return;
    }

    // Only handle the main viewport, not the heatmap viewport
    if (viewportId.includes('-heatmap')) {
      isUpdatingRef.current = false;
      return;
    }

    const findOrCreateViewport = (position, positionId, options) => {
      console.log('findOrCreateViewport called', { position, positionId, options });

      // For the first viewport (position 0), return the original viewport
      if (position === 0) {
        return {
          displaySetInstanceUIDs: [displaySet.displaySetInstanceUID],
          viewportOptions: {
            ...viewportOptions,
            viewportId,
            viewportType: 'stack',
          },
          displaySetOptions: [{}],
          positionId,
        };
      }

      // For the second viewport (position 1), create a new viewport for heatmap
      if (position === 1 && showHeatmap) {
        const heatmapViewportId = `${viewportId}-heatmap`;
        return {
          displaySetInstanceUIDs: [aiResult.heatmapDisplaySet.displaySetInstanceUID],
          viewportOptions: {
            ...viewportOptions,
            viewportId: heatmapViewportId,
            viewportType: 'stack',
            showHeatmap: true,
          },
          displaySetOptions: [{
            colormap: {
              name: 'jet',
              opacity: [
                { value: 0, opacity: 0 },
                { value: 0.25, opacity: 0.5 },
                { value: 0.5, opacity: 0.75 },
                { value: 0.75, opacity: 0.9 },
                { value: 1, opacity: 1 }
              ]
            }
          }],
          positionId,
        };
      }

      return null;
    };

    // Create layout options based on current state
    const layoutOptions = showHeatmap
      ? [
          { x: 0, y: 0, width: 0.5, height: 1 },
          { x: 0.5, y: 0, width: 0.5, height: 1 }
        ]
      : [
          { x: 0, y: 0, width: 1, height: 1 }
        ];

    console.log('Setting display sets', {
      showHeatmap,
      viewportId,
      heatmapViewportId: `${viewportId}-heatmap`
    });

    // First set the display sets
    if (showHeatmap) {
      const heatmapViewportId = `${viewportId}-heatmap`;
      viewportGridService.setDisplaySetsForViewports([
        {
          viewportId,
          displaySetInstanceUIDs: [displaySet.displaySetInstanceUID],
          viewportOptions: {
            ...viewportOptions,
            viewportId,
            viewportType: 'stack',
          },
        },
        {
          viewportId: heatmapViewportId,
          displaySetInstanceUIDs: [aiResult.heatmapDisplaySet.displaySetInstanceUID],
          viewportOptions: {
            ...viewportOptions,
            viewportId: heatmapViewportId,
            viewportType: 'stack',
            showHeatmap: true,
          },
        },
      ]);
    }

    console.log('Setting layout', {
      numCols: showHeatmap ? 2 : 1,
      layoutOptions,
      currentState: viewportGridService.getState()
    });

    // Then set the layout
    viewportGridService.setLayout({
      numRows: 1,
      numCols: showHeatmap ? 2 : 1,
      findOrCreateViewport,
      isHangingProtocolLayout: false,
      activeViewportId: viewportId,
      layoutType: 'grid',
      layoutOptions,
      keepExtraViewports: true
    });

    // Reset the updating flag after a short delay to allow state to settle
    setTimeout(() => {
      isUpdatingRef.current = false;
    }, 100);
  }, [showHeatmap, aiResult, viewportId, displaySet, viewportOptions, viewportGridService]);

  // Effect for initial setup and cleanup
  useEffect(() => {
    // Only run for the main viewport, not the heatmap viewport
    if (!aiResult?.hasHeatmap || isUpdatingRef.current || viewportId.includes('-heatmap')) return;

    console.log('Initial setup effect running', {
      hasHeatmap: aiResult?.hasHeatmap,
      showHeatmap,
      viewportId
    });

    // Initial setup
    handleHeatmapToggle();

    // Cleanup function
    return () => {
      if (!showHeatmap || isUpdatingRef.current) return;

      console.log('Cleanup running', {
        showHeatmap,
        viewportId,
        currentState: viewportGridService.getState()
      });

      // Reset to single viewport
      viewportGridService.setDisplaySetsForViewports([
        {
          viewportId,
          displaySetInstanceUIDs: [displaySet.displaySetInstanceUID],
          viewportOptions: {
            ...viewportOptions,
            viewportId,
            viewportType: 'stack',
          },
        },
      ]);

      viewportGridService.setLayout({
        numRows: 1,
        numCols: 1,
        findOrCreateViewport: (position, positionId) => ({
          displaySetInstanceUIDs: [displaySet.displaySetInstanceUID],
          viewportOptions: {
            ...viewportOptions,
            viewportId,
            viewportType: 'stack',
          },
          displaySetOptions: [{}],
          positionId,
        }),
        isHangingProtocolLayout: false,
        activeViewportId: viewportId,
        layoutType: 'grid',
        layoutOptions: [{ x: 0, y: 0, width: 1, height: 1 }],
        keepExtraViewports: true
      });
    };
  }, [aiResult?.hasHeatmap, handleHeatmapToggle, viewportId, displaySet, viewportOptions, viewportGridService]);

  // Update viewport when showHeatmap changes
  useEffect(() => {
    // Only run for the main viewport, not the heatmap viewport
    if (!aiResult?.hasHeatmap || isUpdatingRef.current || viewportId.includes('-heatmap')) return;

    console.log('showHeatmap effect running', {
      showHeatmap,
      hasHeatmap: aiResult?.hasHeatmap,
      viewportId,
      currentState: viewportGridService.getState()
    });

    handleHeatmapToggle();
  }, [showHeatmap, handleHeatmapToggle, aiResult?.hasHeatmap]);

  // Update the viewport overlay customization effect
  useEffect(() => {
    if (!aiResult) return;

    // Configure viewport overlays
    customizationService.setCustomizations({
      'viewportOverlay.topLeft': {
        $push: [
          {
            id: 'AIStatus',
            inheritsFrom: 'ohif.overlayItem',
            label: '',
            title: 'AI Results Status',
            color: '#9ccef9',
            contentF: ({ instance }) => {
              return (
                <div className="overlay-item flex flex-row">
                  <span className="mr-1 shrink-0">AI:</span>
                  <span className="ml-1 shrink-0">{aiResult ? 'Available' : 'Not Available'}</span>
                </div>
              );
            }
          }
        ]
      },
      'viewportOverlay.topRight': {
        $push: [
          {
            id: 'AIClassification',
            inheritsFrom: 'ohif.overlayItem',
            title: 'AI Classification',
            color: '#9ccef9',
            contentF: ({ instance }) => {
              if (!aiResult?.classifications || viewportId.includes('-heatmap')) return null;
              const currentClassification = aiResult.classifications[currentResultIndex];
              return (
                <div className="overlay-item flex flex-col">
                  <div className="flex flex-row items-center">
                    <span className="mr-1 shrink-0">{currentClassification.side} Breast:</span>
                    <span className={`ml-1 shrink-0 ${currentClassification.isMalignant ? 'text-red-400' : 'text-green-400'}`}>
                      {currentClassification.isMalignant ? 'Malignant' : 'Benign'}
                    </span>
                  </div>
                  <div className="flex flex-row items-center">
                    <span className="mr-1 shrink-0">Confidence:</span>
                    <span className="ml-1 shrink-0">{(currentClassification.confidence * 100).toFixed(1)}%</span>
                  </div>
                  {aiResult.classifications.length > 1 && (
                    <div className="flex flex-row items-center mt-1">
                      <span className="mr-1 shrink-0">Result:</span>
                      <span className="ml-1 shrink-0">{currentResultIndex + 1} of {aiResult.classifications.length}</span>
                      <div className="ml-2 flex flex-row pointer-events-auto">
                        <button
                          className="px-1 text-sm hover:text-white cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAIResultChange('prev');
                          }}
                        >
                          ←
                        </button>
                        <button
                          className="px-1 text-sm hover:text-white cursor-pointer"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleAIResultChange('next');
                          }}
                        >
                          →
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              );
            }
          }
        ]
      }
    });

    // Add heatmap toggle to viewport action corners
    if (!viewportId.includes('-heatmap')) {
      const components = [];

    if (aiResult?.hasHeatmap) {
        components.push({
        viewportId,
        id: 'HeatmapToggle',
        component: (
          <HeatmapToggle
            onToggle={() => setShowHeatmap(!showHeatmap)}
            className={viewportId === activeViewportId ? 'visible' : 'invisible group-hover/pane:visible'}
            isActive={showHeatmap}
          />
        ),
        location: viewportActionCornersService.LOCATIONS.topRight,
        indexPriority: 0
      });
      }

      if (components.length > 0) {
        viewportActionCornersService.addComponents(components);
      }
    }

    // Cleanup function
    return () => {
      customizationService.setCustomizations({
        'viewportOverlay.topLeft': {
          $splice: [[0, 1]]
        },
        'viewportOverlay.topRight': {
          $splice: [[0, 1]]
        }
      });
      viewportActionCornersService.clear(viewportId);
    };
  }, [aiResult, showHeatmap, viewportId, activeViewportId, customizationService, viewportActionCornersService, handleAIResultChange, currentResultIndex]);

  const getCornerstoneViewport = () => {
    const { component: Component } = extensionManager.getModuleEntry(
      '@ohif/extension-cornerstone.viewportModule.cornerstone'
    );

    // Ensure viewportOptions has the required properties
    const mergedViewportOptions = {
      ...viewportOptions,
      viewportId,
      viewportType: viewportOptions.viewportType || 'stack',
      toolGroupId: viewportOptions.toolGroupId || 'default',
    };

    return (
      <Component
        {...props}
        viewportId={viewportId}
        displaySets={displaySets}
        viewportOptions={mergedViewportOptions}
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
    </div>
  );
};

export default AITrackedViewport;
