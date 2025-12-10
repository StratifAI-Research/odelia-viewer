// @ts-nocheck
import React, { useEffect, useState, useCallback } from 'react';
import { useImageViewer } from '@ohif/ui';
import { useViewportGrid } from '@ohif/ui-next';
import OrthancAIService from '../services/OrthancAIService';
import { useWizardState } from '../hooks/useWizardState';
import { useStudySeriesSelection } from '../hooks/useStudySeriesSelection';
import { useAIRouting } from '../hooks/useAIRouting';
import { SeriesSelectionStep } from './steps/SeriesSelectionStep';
import { EndpointSelectionStep } from './steps/EndpointSelectionStep';
import { ProgressStep } from './steps/ProgressStep';

interface ServicesManager {
  services: {
    orthancAIService: OrthancAIService;
    displaySetService: any;
    uiNotificationService: any;
    customizationService: any;
  };
}

interface AIRoutingPanelProps {
  servicesManager: ServicesManager;
}

const AIRoutingPanel: React.FC<AIRoutingPanelProps> = ({ servicesManager }) => {
  const {
    orthancAIService,
    displaySetService,
    uiNotificationService,
    customizationService,
  } = servicesManager.services;

  // Get the ProgressLoadingBar component from the customization service
  const ProgressLoadingBar = customizationService.getCustomization('ui.progressLoadingBar');

  // Get the actual DICOM StudyInstanceUID from the URL (fallback only)
  const dicomStudyUID = orthancAIService.getDicomStudyInstanceUIDFromURL();

  // Viewport tracking hooks (from FeedbackPanel pattern)
  const { StudyInstanceUIDs } = useImageViewer();
  const [{ activeViewportId, viewports }, viewportGridService] = useViewportGrid();

  // Wizard state management - start at step 1 (series selection, no study selection needed)
  const wizard = useWizardState(1);

  // Active study state (auto-detected from viewport)
  const [activeStudyUID, setActiveStudyUID] = useState<string | null>(null);

  // Helper to extract study UID from the active viewport
  const getStudyUIDFromActiveViewport = useCallback((): string | null => {
    if (!activeViewportId || !viewports) {
      return StudyInstanceUIDs?.[0] || dicomStudyUID || null; // Fallback to first study or URL study
    }

    const activeViewport = viewports.get(activeViewportId);
    const displaySetInstanceUIDs = activeViewport?.displaySetInstanceUIDs || [];

    if (!displaySetInstanceUIDs.length) {
      return StudyInstanceUIDs?.[0] || dicomStudyUID || null; // Fallback
    }

    // Get the first display set's study UID
    const firstDisplaySetUID = displaySetInstanceUIDs[0];
    const displaySet = displaySetService?.getDisplaySetByUID(firstDisplaySetUID);

    return displaySet?.StudyInstanceUID || displaySet?.studyInstanceUID || StudyInstanceUIDs?.[0] || dicomStudyUID || null;
  }, [activeViewportId, viewports, displaySetService, StudyInstanceUIDs, dicomStudyUID]);

  // Initialize activeStudyUID on mount
  useEffect(() => {
    let mounted = true;

    if (!activeStudyUID) {
      const initialStudyUID = getStudyUIDFromActiveViewport();
      if (initialStudyUID && mounted) {
        setActiveStudyUID(initialStudyUID);
      }
    }

    return () => {
      mounted = false;
    };
  }, [activeStudyUID, getStudyUIDFromActiveViewport]);

  // Track viewport changes and update activeStudyUID
  useEffect(() => {
    let mounted = true;

    const studyUID = getStudyUIDFromActiveViewport();
    if (studyUID && studyUID !== activeStudyUID && mounted) {
      console.log(`AIRoutingPanel: Study changed from ${activeStudyUID} to ${studyUID}`);
      setActiveStudyUID(studyUID);
      // Reset wizard to step 1 when study changes mid-workflow
      if (wizard.currentStep > 1) {
        wizard.reset();
      }
    }

    return () => {
      mounted = false;
    };
  }, [activeViewportId, viewports, getStudyUIDFromActiveViewport, activeStudyUID, wizard]);

  // Study and series selection management
  const selection = useStudySeriesSelection({
    displaySetService,
    activeStudyUID, // Pass auto-detected study instead of manual selection
  });

  // AI routing management
  const routing = useAIRouting({
    orthancAIService,
    uiNotificationService,
    onComplete: () => {
      // Reload the page to fetch new AI results (SR/SC instances)
      console.log('AI analysis complete, reloading page to display new results...');
      setTimeout(() => {
        window.location.reload();
      }, 1000); // Wait 2 seconds so user can see the completion notification
    },
  });

  // Clean up when component unmounts
  useEffect(() => {
    return () => {
      orthancAIService.stopWorkitemPolling();
    };
  }, [orthancAIService]);

  // Handlers
  const handleSeriesNext = () => {
    if (selection.selectedSeriesUIDs.size > 0) {
      wizard.goToNextStep();
    }
  };

  const handleSendToAI = async () => {
    if (!activeStudyUID) return;

    wizard.goToNextStep(); // Go to progress screen

    const seriesArray = Array.from(selection.selectedSeriesUIDs);
    await routing.sendToAI(activeStudyUID, seriesArray);
  };

  const handleReset = () => {
    wizard.reset();
    selection.reset();
    routing.reset();
  };

  // Get study description for display
  const getStudyDescription = () => {
    if (!activeStudyUID) return 'No Study Selected';
    const study = selection.availableStudies.find(
      st => st.studyInstanceUid === activeStudyUID
    );
    return study?.description || activeStudyUID.slice(0, 20) + '...';
  };

  // Render current step
  const renderStep = () => {
    switch (wizard.currentStep) {
      case 1:
        // Step 1: Series Selection (was Step 2)
        return (
          <SeriesSelectionStep
            series={selection.availableSeries}
            selectedSeriesUIDs={selection.selectedSeriesUIDs}
            onToggleSeries={selection.toggleSeries}
            onSelectAll={selection.selectAllSeries}
            onClearSelection={selection.clearSeriesSelection}
            onNext={handleSeriesNext}
            onBack={wizard.goToPrevStep}
            onRetry={selection.retrySeries}
            isLoading={selection.isLoadingSeries}
            error={selection.seriesError || routing.error}
          />
        );

      case 2:
        // Step 2: Endpoint Selection (was Step 3)
        return (
          <EndpointSelectionStep
            currentEndpoint={routing.currentEndpoint}
            onEndpointChange={routing.handleEndpointChange}
            studyDescription={getStudyDescription()}
            selectedSeriesCount={selection.selectedSeriesUIDs.size}
            onSend={handleSendToAI}
            onBack={wizard.goToPrevStep}
            error={routing.error}
          />
        );

      case 3:
        // Step 3: Progress (was Step 4)
        return (
          <ProgressStep
            status={routing.status}
            progress={routing.progress}
            error={routing.error}
            progressDescription={routing.progressDescription}
            onReset={handleReset}
            ProgressLoadingBar={ProgressLoadingBar}
          />
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Fixed header */}
      <div className="flex-shrink-0 px-3 py-3 border-b border-secondary-light">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-lg font-semibold text-white">AI Analysis</h3>
          <div className="text-xs text-muted-foreground">
            Step {wizard.currentStep} of 3
          </div>
        </div>
        {/* Active Study Indicator */}
        {activeStudyUID && (
          <div className="mt-2 p-2 bg-secondary-dark rounded text-xs">
            <div className="text-muted-foreground">Active Study:</div>
            <div className="font-mono text-white truncate">{getStudyDescription()}</div>
          </div>
        )}
        {!activeStudyUID && (
          <div className="mt-2 p-2 bg-red-900/20 border border-red-700 rounded text-xs text-red-400">
            ⚠️ No study detected in viewport
          </div>
        )}
      </div>

      {/* Step content - constrained to remaining height */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {renderStep()}
      </div>
    </div>
  );
};

export default AIRoutingPanel;
