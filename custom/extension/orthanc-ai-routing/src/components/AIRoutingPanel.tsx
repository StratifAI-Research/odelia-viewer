import React, { useEffect, useState, useCallback } from 'react';
import { useImageViewer } from '@ohif/ui';
import { useViewportGrid } from '@ohif/ui-next';
import OrthancAIService from '../services/OrthancAIService';
import type { ModelManifest } from '../services/OrthancAIService';
import { useWizardState } from '../hooks/useWizardState';
import { useStudySeriesSelection } from '../hooks/useStudySeriesSelection';
import { useAIRouting } from '../hooks/useAIRouting';
import { useInputMapping } from '../hooks/useInputMapping';
import AIEndpointConfig from './AIEndpointConfig';
import { ModelSelectionStep } from './steps/ModelSelectionStep';
import { SeriesSelectionStep } from './steps/SeriesSelectionStep';
import { InputModeSelectionStep } from './steps/InputModeSelectionStep';
import { InputMappingStep } from './steps/InputMappingStep';
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

  const ProgressLoadingBar = customizationService.getCustomization('ui.progressLoadingBar');

  const dicomStudyUID = orthancAIService.getDicomStudyInstanceUIDFromURL();

  const { StudyInstanceUIDs } = useImageViewer();
  const [{ activeViewportId, viewports }, viewportGridService] = useViewportGrid();

  const wizard = useWizardState(1);

  const [activeStudyUID, setActiveStudyUID] = useState<string | null>(null);
  const [manifest, setManifest] = useState<ModelManifest | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsKey, setSettingsKey] = useState(0);

  const inputMappingHook = useInputMapping(manifest);

  const getStudyUIDFromActiveViewport = useCallback((): string | null => {
    if (!activeViewportId || !viewports) {
      return StudyInstanceUIDs?.[0] || dicomStudyUID || null;
    }

    const activeViewport = viewports.get(activeViewportId);
    const displaySetInstanceUIDs = activeViewport?.displaySetInstanceUIDs || [];

    if (!displaySetInstanceUIDs.length) {
      return StudyInstanceUIDs?.[0] || dicomStudyUID || null;
    }

    const firstDisplaySetUID = displaySetInstanceUIDs[0];
    const displaySet = displaySetService?.getDisplaySetByUID(firstDisplaySetUID);

    return displaySet?.StudyInstanceUID || displaySet?.studyInstanceUID || StudyInstanceUIDs?.[0] || dicomStudyUID || null;
  }, [activeViewportId, viewports, displaySetService, StudyInstanceUIDs, dicomStudyUID]);

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

  useEffect(() => {
    let mounted = true;

    const studyUID = getStudyUIDFromActiveViewport();
    if (studyUID && studyUID !== activeStudyUID && mounted) {
      console.log(`AIRoutingPanel: Study changed from ${activeStudyUID} to ${studyUID}`);
      setActiveStudyUID(studyUID);
      if (wizard.currentStep > 1) {
        wizard.reset();
        setManifest(null);
        inputMappingHook.reset();
      }
    }

    return () => {
      mounted = false;
    };
  }, [activeViewportId, viewports, getStudyUIDFromActiveViewport, activeStudyUID, wizard]);

  // If we reach the input-mapping step (3) without a valid selected model
  // config, fall back to model selection (2). Done in an effect rather than
  // during render to avoid updating wizard state while rendering.
  useEffect(() => {
    const hasSelectedConfig =
      manifest &&
      !!manifest.input_configurations.find(c => c.id === inputMappingHook.selectedConfigId);
    if (wizard.currentStep === 3 && manifest && !hasSelectedConfig) {
      wizard.goToStep(2);
    }
  }, [wizard.currentStep, manifest, inputMappingHook.selectedConfigId, wizard]);

  const selection = useStudySeriesSelection({
    displaySetService,
    activeStudyUID,
  });

  const routing = useAIRouting({
    orthancAIService,
    uiNotificationService,
    onComplete: () => {
      console.log('AI analysis complete, reloading page to display new results...');
      setTimeout(() => {
        window.location.reload();
      }, 1000);
    },
  });

  useEffect(() => {
    return () => {
      orthancAIService.stopWorkitemPolling();
    };
  }, [orthancAIService]);

  // With manifest:    1 → 2 (mode) → 3 (mapping) → 4 (confirm) → 5 (progress)
  // Without manifest: 1 → 2 (series) → 3 (confirm) → 4 (progress)
  const totalSteps = manifest ? 5 : 4;

  const handleModelNext = () => {
    wizard.goToStep(2);
  };

  const handleModeNext = () => {
    wizard.goToStep(3);
  };

  const handleMappingNext = () => {
    wizard.goToStep(4);
  };

  const handleSeriesNext = () => {
    if (selection.selectedSeriesUIDs.size > 0) {
      wizard.goToStep(3);
    }
  };

  const progressStep = manifest ? 5 : 4;

  const handleSendToAI = async () => {
    if (!activeStudyUID) return;

    wizard.goToStep(progressStep);

    if (manifest && inputMappingHook.isValid) {
      const seriesArray = inputMappingHook.getSelectedSeriesUIDs();
      const mappingData = inputMappingHook.getInputMapping();
      await routing.sendToAI(
        activeStudyUID,
        seriesArray,
        mappingData,
        inputMappingHook.selectedConfigId ?? undefined
      );
    } else {
      const seriesArray = Array.from(selection.selectedSeriesUIDs);
      await routing.sendToAI(activeStudyUID, seriesArray);
    }
  };

  const handleReset = () => {
    wizard.reset();
    selection.reset();
    routing.reset();
    setManifest(null);
    inputMappingHook.reset();
  };

  const getStudyDescription = () => {
    if (!activeStudyUID) return 'No Study Selected';
    const study = selection.availableStudies.find(
      st => st.studyInstanceUid === activeStudyUID
    );
    return study?.description || activeStudyUID.slice(0, 20) + '...';
  };

  const getSelectedConfig = () => {
    if (!manifest || !inputMappingHook.selectedConfigId) return null;
    return manifest.input_configurations.find(
      c => c.id === inputMappingHook.selectedConfigId
    ) ?? null;
  };

  const getInputMappingDescription = (): string | null => {
    const config = getSelectedConfig();
    if (!config) return null;

    const lines = config.inputs.map(input => {
      const uid = inputMappingHook.mapping[input.key];
      const series = uid
        ? selection.availableSeries.find(s => s.SeriesInstanceUID === uid)
        : null;
      const label = series
        ? series.SeriesDescription || `Series ${series.SeriesNumber}`
        : 'Not assigned';
      return `${input.label}: ${label}`;
    });
    return lines.join('\n');
  };

  const handleCloseSettings = () => {
    setIsSettingsOpen(false);
    setSettingsKey(k => k + 1);
  };

  const renderSettingsOverlay = () => {
    if (!isSettingsOpen) return null;

    return (
      <div className="absolute inset-0 bg-black/80 z-50 flex flex-col p-4">
        <div className="bg-gray-900 rounded-lg w-full flex-1 overflow-y-auto border border-gray-700">
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
            <h3 className="text-sm font-semibold text-white">Endpoint Settings</h3>
            <button
              onClick={handleCloseSettings}
              className="text-gray-400 hover:text-white"
            >
              ✕
            </button>
          </div>
          <div className="p-4">
            <AIEndpointConfig
              onEndpointChange={(endpoint) => {
                routing.handleEndpointChange(endpoint);
              }}
              currentEndpoint={routing.currentEndpoint}
            />
          </div>
        </div>
      </div>
    );
  };

  const renderStep = () => {
    switch (wizard.currentStep) {
      case 1:
        return (
          <ModelSelectionStep
            key={`model-${settingsKey}`}
            orthancAIService={orthancAIService}
            currentEndpoint={routing.currentEndpoint}
            onEndpointChange={routing.handleEndpointChange}
            manifest={manifest}
            onManifestLoaded={setManifest}
            onNext={handleModelNext}
            error={routing.error}
          />
        );

      case 2:
        if (manifest) {
          return (
            <InputModeSelectionStep
              manifest={manifest}
              selectedConfigId={inputMappingHook.selectedConfigId}
              onSelectConfig={inputMappingHook.setSelectedConfigId}
              onNext={handleModeNext}
              onBack={() => wizard.goToStep(1)}
            />
          );
        }
        return (
          <SeriesSelectionStep
            series={selection.availableSeries}
            selectedSeriesUIDs={selection.selectedSeriesUIDs}
            onToggleSeries={selection.toggleSeries}
            onSelectAll={selection.selectAllSeries}
            onClearSelection={selection.clearSeriesSelection}
            onNext={handleSeriesNext}
            onBack={() => wizard.goToStep(1)}
            onRetry={selection.retrySeries}
            isLoading={selection.isLoadingSeries}
            error={selection.seriesError || routing.error}
          />
        );

      case 3: {
        if (manifest) {
          const selectedConfig = getSelectedConfig();
          if (!selectedConfig) {
            // Invalid state; the effect above will navigate back to step 2.
            return null;
          }
          return (
            <InputMappingStep
              selectedConfig={selectedConfig}
              availableSeries={selection.availableSeries}
              mapping={inputMappingHook.mapping}
              onSetInputSeries={inputMappingHook.setInputSeries}
              onAutoDetect={inputMappingHook.autoDetect}
              isValid={inputMappingHook.isValid}
              onNext={handleMappingNext}
              onBack={() => wizard.goToStep(2)}
            />
          );
        }
        return (
          <EndpointSelectionStep
            currentEndpoint={routing.currentEndpoint}
            studyDescription={getStudyDescription()}
            selectedSeriesCount={selection.selectedSeriesUIDs.size}
            onSend={handleSendToAI}
            onBack={() => wizard.goToStep(2)}
            error={routing.error}
          />
        );
      }

      case 4: {
        if (manifest) {
          return (
            <EndpointSelectionStep
              currentEndpoint={routing.currentEndpoint}
              studyDescription={getStudyDescription()}
              selectedSeriesCount={inputMappingHook.getSelectedSeriesUIDs().length}
              inputMappingDescription={getInputMappingDescription()}
              onSend={handleSendToAI}
              onBack={() => wizard.goToStep(3)}
              error={routing.error}
            />
          );
        }
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
      }

      case 5:
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
    <div className="flex flex-col h-full min-h-0 relative">
      {renderSettingsOverlay()}

      <div className="flex-shrink-0 px-3 py-2 border-b border-secondary-light">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">AI Analysis</h3>
          <div className="flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              Step {wizard.currentStep} of {totalSteps}
            </span>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="p-1.5 hover:bg-gray-700 rounded text-primary-active hover:text-white"
              title="Endpoint Settings"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="w-4 h-4"
              >
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
              </svg>
            </button>
          </div>
        </div>
        {!activeStudyUID && (
          <div className="mt-2 p-2 bg-red-900/20 border border-red-700 rounded text-xs text-red-400">
            No study detected in viewport
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        {renderStep()}
      </div>
    </div>
  );
};

export default AIRoutingPanel;
