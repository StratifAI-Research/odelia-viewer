import React, { useEffect, useState, useCallback } from 'react';
import { Button, Icons, useImageViewer, useViewportGrid } from '@ohif/ui-next';
import OrthancAIService from '../services/OrthancAIService';
import type { ModelManifest } from '../services/OrthancAIService';
import { useWizardState } from '../hooks/useWizardState';
import { useStudySeriesSelection } from '../hooks/useStudySeriesSelection';
import { useAIRouting } from '../hooks/useAIRouting';
import { useInputMapping } from '../hooks/useInputMapping';
import AIEndpointConfig, { type AIEndpoint } from './AIEndpointConfig';
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
  const [{ activeViewportId, viewports }] = useViewportGrid();

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

  // One effect covers both the initial resolve and every later change: on mount
  // `activeStudyUID` is null, so the inequality below is already true. A separate
  // "initialize on mount" effect only added a second render pass.
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

  /**
   * Everything downstream of the model is invalidated when the model changes.
   *
   * This lives in the panel because the endpoint has TWO entry points and they
   * were not equivalent. `ModelSelectionStep` had its own handler that cleared
   * the manifest cache and refetched; the gear in the panel header passed
   * `routing.handleEndpointChange` straight through, which only sets state and
   * shows a toast. `handleCloseSettings` bumping `settingsKey` did re-sync — but
   * only via the `key={model-...}` remount, and `renderStep()` mounts
   * `ModelSelectionStep` on step 1 only, while the gear is available on every
   * step. So on steps 2-4 the manifest survived the switch, and Send posted
   * model B's `target`/`target_url` together with model A's
   * `input_configuration_id` and A's role keys. `ConfirmStep` reads the model
   * name from `currentEndpoint`, so it displayed B: nothing on screen revealed
   * the mismatch.
   *
   * Returning to step 1 is deliberate. The role mapping is expressed in the
   * previous model's input keys, so there is nothing to carry forward.
   *
   * The SERIES selection is deliberately NOT cleared: it hangs off the study,
   * not the model, and the reader would have to pick the same series again for
   * no reason. Study changes reset it, in the effect above.
   */
  const handleEndpointChange = useCallback(
    (endpoint: AIEndpoint) => {
      const previous = routing.currentEndpoint;
      // What the manifest, the role mapping and the wizard hang off is the MODEL
      // — identified by id and target url. A display-name edit changes neither,
      // and blowing the wizard back to step 1 for one would silently discard a
      // completed role mapping because someone relabelled an endpoint in the
      // settings dialog. Adopt the new label, keep the work.
      const sameModel =
        !!previous && previous.id === endpoint.id && previous.url === endpoint.url;

      routing.handleEndpointChange(endpoint);

      if (sameModel) {
        return;
      }

      orthancAIService.clearManifestCache();
      setManifest(null);
      inputMappingHook.reset();
      wizard.reset();
    },
    [routing, orthancAIService, inputMappingHook, wizard]
  );

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

  /**
   * A model that publishes an input specification but whose role mapping no
   * longer satisfies it. The mapping can go stale AFTER the reader reaches
   * Confirm -- InputMappingStep gates its own Next on `isValid`, but display sets
   * can change underneath and drop a mapped series, and nothing re-checked it at
   * step 4.
   */
  const mappingIncomplete = !!manifest && !inputMappingHook.isValid;

  const handleSendToAI = async () => {
    if (!activeStudyUID) {
      return;
    }

    // Refuse, rather than fall through to the flat branch below. That `else` is
    // the correct path for a model that genuinely publishes no specification --
    // but it was also reached when a manifest EXISTS and its mapping is invalid,
    // which silently posts a bare series_uids list with no input_mapping and no
    // input_configuration_id. MST then assigns the pre/post/subtraction roles
    // itself and returns a normal-looking result computed on the wrong inputs.
    // Send is disabled in this state too; this is the second line of defence.
    if (mappingIncomplete) {
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
      <div className="bg-background/80 absolute inset-0 z-50 flex flex-col p-4">
        <div className="border-input bg-muted w-full flex-1 overflow-y-auto rounded-lg border">
          <div className="border-input flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-foreground text-base font-semibold">Endpoint Settings</h3>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleCloseSettings}
              aria-label="Close endpoint settings"
            >
              <Icons.Close className="h-5 w-5" />
            </Button>
          </div>
          <div className="p-4">
            <AIEndpointConfig
              onEndpointChange={handleEndpointChange}
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
            onEndpointChange={handleEndpointChange}
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
              mappingIncomplete={mappingIncomplete}
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

      <div className="border-input flex-shrink-0 border-b px-3 py-2">
        <div className="flex items-center justify-between">
          <h3 className="text-foreground text-lg font-semibold">AI Analysis</h3>
          <div className="flex items-center gap-3">
            <span className="text-muted-foreground text-xs">
              Step {wizard.currentStep} of {totalSteps}
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSettingsOpen(true)}
              title="Endpoint Settings"
              aria-label="Endpoint Settings"
            >
              <Icons.GearSettings className="h-5 w-5" />
            </Button>
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
