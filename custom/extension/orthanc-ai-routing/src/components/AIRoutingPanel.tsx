import React, { useEffect, useState, useCallback } from 'react';
import { useImageViewer, useViewportGrid } from '@ohif/ui-next';
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
import { ConfirmStep } from './steps/ConfirmStep';
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
  const { orthancAIService, displaySetService, uiNotificationService, customizationService } =
    servicesManager.services;

  const ProgressLoadingBar = customizationService.getCustomization('ui.progressLoadingBar');

  // Read the URL-derived study UID on every render so it stays correct across
  // in-app navigation (route/query changes while this panel stays mounted).
  // It returns a stable string when the URL is unchanged, so it does not cause
  // effect churn. Do NOT memoize on the stable service — that would freeze it
  // to the study active at mount.
  const dicomStudyUID = orthancAIService.getDicomStudyInstanceUIDFromURL();

  // ImageViewerContext is created with `createContext(null)` upstream, so the
  // hook is typed as null; the provider always supplies StudyInstanceUIDs.
  const { StudyInstanceUIDs } = useImageViewer() as unknown as { StudyInstanceUIDs: string[] };
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

    return (
      displaySet?.StudyInstanceUID ||
      displaySet?.studyInstanceUID ||
      StudyInstanceUIDs?.[0] ||
      dicomStudyUID ||
      null
    );
  }, [activeViewportId, viewports, displaySetService, StudyInstanceUIDs, dicomStudyUID]);

  useEffect(() => {
    if (!activeStudyUID) {
      const initialStudyUID = getStudyUIDFromActiveViewport();
      if (initialStudyUID) {
        setActiveStudyUID(initialStudyUID);
      }
    }
  }, [activeStudyUID, getStudyUIDFromActiveViewport]);

  useEffect(() => {
    const studyUID = getStudyUIDFromActiveViewport();
    if (studyUID && studyUID !== activeStudyUID) {
      setActiveStudyUID(studyUID);
      if (wizard.currentStep > 1) {
        wizard.reset();
        setManifest(null);
        inputMappingHook.reset();
      }
    }
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

  const reloadTimeoutRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const routing = useAIRouting({
    orthancAIService,
    uiNotificationService,
    onComplete: () => {
      reloadTimeoutRef.current = setTimeout(() => {
        window.location.reload();
      }, 1000);
    },
  });

  useEffect(() => {
    return () => {
      orthancAIService.stopWorkitemPolling();
      // Clear the pending post-completion reload so it can't fire after unmount.
      if (reloadTimeoutRef.current) {
        clearTimeout(reloadTimeoutRef.current);
      }
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
    if (!activeStudyUID) {
      return;
    }

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
    if (!activeStudyUID) {
      return 'No Study Selected';
    }
    const study = selection.availableStudies.find(st => st.studyInstanceUid === activeStudyUID);
    return study?.description || activeStudyUID.slice(0, 20) + '...';
  };

  const getSelectedConfig = () => {
    if (!manifest || !inputMappingHook.selectedConfigId) {
      return null;
    }
    return (
      manifest.input_configurations.find(c => c.id === inputMappingHook.selectedConfigId) ?? null
    );
  };

  const getInputMappingDescription = (): string | null => {
    const config = getSelectedConfig();
    if (!config) {
      return null;
    }

    const lines = config.inputs.map(input => {
      const uid = inputMappingHook.mapping[input.key];
      const series = uid ? selection.availableSeries.find(s => s.SeriesInstanceUID === uid) : null;
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
    if (!isSettingsOpen) {
      return null;
    }

    return (
      <div className="absolute inset-0 z-50 flex flex-col bg-black/80 p-4">
        <div className="w-full flex-1 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900">
          <div className="flex items-center justify-between border-b border-gray-700 px-4 py-3">
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
              onEndpointChange={endpoint => {
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
          <ConfirmStep
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
            <ConfirmStep
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
    <div className="relative flex h-full min-h-0 flex-col">
      {renderSettingsOverlay()}

      <div className="border-secondary-light flex-shrink-0 border-b px-3 py-2">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">AI Analysis</h3>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground text-xs">
              Step {wizard.currentStep} of {totalSteps}
            </span>
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="text-primary-active rounded p-1.5 hover:bg-gray-700 hover:text-white"
              title="Endpoint Settings"
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="h-4 w-4"
              >
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
              </svg>
            </button>
          </div>
        </div>
        {!activeStudyUID && (
          <div className="mt-2 rounded border border-red-700 bg-red-900/20 p-2 text-xs text-red-400">
            No study detected in viewport
          </div>
        )}
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">{renderStep()}</div>
    </div>
  );
};

export default AIRoutingPanel;
