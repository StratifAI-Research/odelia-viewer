import React, { useState, useEffect } from 'react';
import { Button } from '@ohif/ui';
import { requestDisplaySetCreationForStudy } from '@ohif/extension-default';
import OrthancAIService from '../services/OrthancAIService';
import AIEndpointConfig, { AIEndpoint } from './AIEndpointConfig';
import StudySelector, { StudyInfo } from './StudySelector';
import SeriesSelector, { SeriesInfo } from './SeriesSelector';

interface ViewportGridService {
  getState: () => {
    viewports: Map<string, {
      displaySetInstanceUIDs?: string[];
      displaySetOptions?: any[];
      viewportOptions?: any;
      isReady?: boolean;
    }>;
    activeViewportId: string | null;
  };
  subscribe: (event: string, callback: () => void) => { unsubscribe: () => void };
  EVENTS: {
    ACTIVE_VIEWPORT_ID_CHANGED: string;
    GRID_STATE_CHANGED: string;
    VIEWPORTS_READY: string;
  };
}

interface ServicesManager {
  services: {
    viewportGridService: ViewportGridService;
    orthancAIService: OrthancAIService;
    displaySetService: any;
    hangingProtocolService: any;
    uiNotificationService: any;
    customizationService: any;
    dataSourceService: any;
  };
  getDataSource: () => any;
}

interface AIRoutingPanelProps {
  servicesManager: ServicesManager;
}

const AIRoutingPanel: React.FC<AIRoutingPanelProps> = ({ servicesManager }) => {
  // Wizard step state
  const [currentStep, setCurrentStep] = useState<1 | 2 | 3 | 4>(1);

  const [status, setStatus] = useState<'idle' | 'routing' | 'checking' | 'refreshing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [currentEndpoint, setCurrentEndpoint] = useState<AIEndpoint | null>(null);

  // Study and Series selection state
  const [availableStudies, setAvailableStudies] = useState<StudyInfo[]>([]);
  const [selectedStudyUID, setSelectedStudyUID] = useState<string | null>(null);
  const [availableSeries, setAvailableSeries] = useState<SeriesInfo[]>([]);
  const [selectedSeriesUIDs, setSelectedSeriesUIDs] = useState<Set<string>>(new Set());

  const {
    orthancAIService,
    displaySetService,
    hangingProtocolService,
    uiNotificationService,
    customizationService,
    dataSourceService
  } = servicesManager.services;

  // Get the ProgressLoadingBar component from the customization service
  const ProgressLoadingBar = customizationService.getCustomization('ui.progressLoadingBar');

  // Get the actual DICOM StudyInstanceUID from the URL
  const dicomStudyUID = orthancAIService.getDicomStudyInstanceUIDFromURL();

  // Load the current endpoint on component mount
  useEffect(() => {
    const endpoint = orthancAIService.getCurrentEndpoint();
    setCurrentEndpoint(endpoint);
  }, [orthancAIService]);

  // Clean up when component unmounts
  useEffect(() => {
    return () => {
      // Stop any polling when component unmounts
      orthancAIService.stopRefreshCheck();
    };
  }, [orthancAIService]);

  // Load available studies from displaySetService
  useEffect(() => {
    const loadStudies = () => {
      const displaySets = displaySetService.getActiveDisplaySets();

      // Group display sets by study
      const studyMap = new Map<string, any>();
      displaySets.forEach((ds: any) => {
        const studyUID = ds.StudyInstanceUID;
        if (!studyMap.has(studyUID)) {
          studyMap.set(studyUID, {
            studyInstanceUid: studyUID,
            date: ds.StudyDate || '',
            description: ds.StudyDescription || '',
            numInstances: 0,
            numSeries: 0,
            hasAIResults: false,
            series: []
          });
        }

        const study = studyMap.get(studyUID);
        study.numInstances += ds.numImageFrames || 0;

        // Check if this is an AI result
        if (ds.Modality === 'SR' || ds.Modality === 'SC') {
          study.hasAIResults = true;
        } else {
          // Only count original series (not AI results)
          study.numSeries++;
        }
      });

      const studies = Array.from(studyMap.values());
      setAvailableStudies(studies);

      // Auto-select primary study from URL or first study (only if none selected)
      if (studies.length > 0 && !selectedStudyUID) {
        const primaryStudy = studies.find(s => s.studyInstanceUid === dicomStudyUID) || studies[0];
        setSelectedStudyUID(primaryStudy.studyInstanceUid);
      }
    };

    loadStudies();

    // Subscribe to display set changes
    const subscription = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_CHANGED,
      loadStudies
    );

    return () => subscription.unsubscribe();
  }, [displaySetService, dicomStudyUID, selectedStudyUID]);

  // Handle study selection - load series for the selected study
  const handleStudySelect = (studyUID: string) => {
    console.log('Study selected:', studyUID);
    setSelectedStudyUID(studyUID);

    // Clear previous series selection
    setAvailableSeries([]);
    setSelectedSeriesUIDs(new Set());

    // Get all display sets for this study (exclude AI results)
    const displaySets = displaySetService.getActiveDisplaySets();
    const seriesForStudy = displaySets.filter((ds: any) =>
      ds.StudyInstanceUID === studyUID &&
      ds.Modality !== 'SR' && // Exclude structured reports
      ds.Modality !== 'SC'    // Exclude secondary captures (AI heatmaps)
    );

    console.log(`Found ${seriesForStudy.length} series for study ${studyUID}`);

    const mappedSeries: SeriesInfo[] = seriesForStudy.map((ds: any) => ({
      displaySetInstanceUID: ds.displaySetInstanceUID,
      SeriesInstanceUID: ds.SeriesInstanceUID,
      SeriesDescription: ds.SeriesDescription || '',
      SeriesNumber: ds.SeriesNumber || 0,
      Modality: ds.Modality,
      numImageFrames: ds.numImageFrames || 0,
      StudyInstanceUID: ds.StudyInstanceUID,
    }));

    setAvailableSeries(mappedSeries);

    // Auto-select all series by default
    const allSeriesUIDs = new Set(mappedSeries.map(s => s.SeriesInstanceUID));
    setSelectedSeriesUIDs(allSeriesUIDs);

    console.log(`Auto-selected ${allSeriesUIDs.size} series`);
  };

  // Handle series toggle
  const handleSeriesToggle = (seriesUID: string) => {
    const newSelection = new Set(selectedSeriesUIDs);
    if (newSelection.has(seriesUID)) {
      newSelection.delete(seriesUID);
    } else {
      newSelection.add(seriesUID);
    }
    setSelectedSeriesUIDs(newSelection);
  };

  // Handle select all series
  const handleSelectAll = () => {
    const allSeriesUIDs = new Set(availableSeries.map(s => s.SeriesInstanceUID));
    setSelectedSeriesUIDs(allSeriesUIDs);
  };

  // Handle clear selection
  const handleClearSelection = () => {
    setSelectedSeriesUIDs(new Set());
  };

  // Wizard navigation
  const goToNextStep = () => {
    if (currentStep < 4) {
      setCurrentStep((currentStep + 1) as 1 | 2 | 3 | 4);
    }
  };

  const goToPrevStep = () => {
    if (currentStep > 1) {
      setCurrentStep((currentStep - 1) as 1 | 2 | 3 | 4);
    }
  };

  const resetWizard = () => {
    setCurrentStep(1);
    setSelectedStudyUID(null);
    setAvailableSeries([]);
    setSelectedSeriesUIDs(new Set());
    setStatus('idle');
    setProgress(0);
    setError(null);
  };

  // Handle step 1 -> 2: Study selected, load series
  const handleStudySelectedAndNext = (studyUID: string) => {
    handleStudySelect(studyUID);
    goToNextStep();
  };

  // Handle step 2 -> 3: Series selected, go to endpoint
  const handleSeriesConfirmed = () => {
    if (selectedSeriesUIDs.size > 0) {
      goToNextStep();
    }
  };

  // Handle endpoint change
  const handleEndpointChange = (endpoint: AIEndpoint) => {
    setCurrentEndpoint(endpoint);
    orthancAIService.setCurrentEndpoint(endpoint);

    // Show notification
    uiNotificationService.show({
      title: 'AI Endpoint Changed',
      message: `Using AI endpoint: ${endpoint.name}`,
      type: 'info',
      duration: 3000,
    });
  };

  // Handle refreshing the display when new AI results are detected
  const handleNewAIResults = () => {
    console.log('New AI analysis results detected!');
    setStatus('idle');
    setProgress(100);

    // Show completion message
    uiNotificationService.show({
      title: 'AI Analysis Results Ready',
      message: 'New AI analysis results have been loaded',
      type: 'success',
      duration: 5000,
    });
  };

  const handleRouteToAI = async () => {
    if (!selectedStudyUID) {
      setError('No study selected');
      return;
    }

    if (!currentEndpoint) {
      setError('No AI endpoint configured. Please add an AI endpoint first.');
      return;
    }

    if (selectedSeriesUIDs.size === 0) {
      setError('No series selected');
      return;
    }

    try {
      // Go to progress screen (step 4)
      setCurrentStep(4);

      setStatus('routing');
      setError(null);
      // Start progress at 20% for immediate feedback
      setProgress(20);

      // Start a progress animation
      const progressInterval = setInterval(() => {
        setProgress(prev => {
          // Quickly ramp up to ~40%
          if (prev < 40) {
            const next = prev + 4;
            return next >= 40 ? 40 : next;
          }
          // After 40%, advance slowly to avoid jumping to near-complete too early
          const next = prev + 1;
          // Cap at 80% until AI results are detected
          return next > 80 ? 80 : next;
        });
      }, 2000);

      // Use the new method that extracts the StudyInstanceUID from the URL
      const response = await orthancAIService.routeCurrentStudyToAI();

      // Clear the interval
      clearInterval(progressInterval);
      // Move progress to 45% to indicate the study was accepted and we are now waiting for results
      setProgress(prev => (prev < 45 ? 45 : prev));

      // Start checking for new AI results
      if (response.status === 'success') {
        setStatus('checking');
        setError(null);

        // Show notification
        uiNotificationService.show({
          title: 'Study Sent for AI Analysis',
          message: 'The study has been sent for AI analysis. Results will appear automatically when ready.',
          type: 'info',
          duration: 5000,
        });

        // Start polling for new series
        orthancAIService.startRefreshCheck(handleNewAIResults);
      } else if (response.status === 'error') {
        setError(response.message || 'Unknown error');
        setStatus('idle');

        // Show error notification
        uiNotificationService.show({
          title: 'AI Analysis Failed',
          message: response.message || 'Failed to send study for AI analysis',
          type: 'error',
          duration: 5000,
        });
      } else {
        setStatus('idle');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send study for AI analysis');
      setStatus('idle');
      setProgress(0);

      // Show error notification
      uiNotificationService.show({
        title: 'AI Analysis Failed',
        message: err instanceof Error ? err.message : 'Failed to send study for AI analysis',
        type: 'error',
        duration: 5000,
      });
    }
  };

  // For testing purposes - uncomment to see the progress bar
  // useEffect(() => {
  //   setStatus('routing');
  //   setProgress(50);
  // }, []);

  // Render different screens based on current step
  const renderStepContent = () => {
    switch (currentStep) {
      case 1:
        // Step 1: Select Study
        return (
          <div className="flex-1 flex flex-col">
            <div className="flex-1 p-4 space-y-4 overflow-y-auto">
              {error && (
                <div className="rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700">
                  {error}
                </div>
              )}

              <div>
                <h4 className="text-sm font-medium mb-3 text-muted-foreground">
                  Select a study to send to AI
                </h4>
                <StudySelector
                  studies={availableStudies}
                  selectedStudyUID={selectedStudyUID}
                  onSelectStudy={setSelectedStudyUID}
                />
              </div>

              <div className="text-xs text-muted-foreground p-2 bg-secondary-dark rounded">
                ℹ️ Studies with 🤖 AI badge already have AI results
              </div>
            </div>

            <div className="p-4 border-t border-secondary-light">
              <Button
                onClick={() => handleStudySelectedAndNext(selectedStudyUID!)}
                disabled={!selectedStudyUID}
                className="w-full"
              >
                Next: Select Series →
              </Button>
            </div>
          </div>
        );

      case 2:
        // Step 2: Select Series
        return (
          <div className="flex-1 flex flex-col">
            <div className="flex-1 p-4 space-y-4 overflow-y-auto">
              {error && (
                <div className="rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700">
                  {error}
                </div>
              )}

              <div>
                <h4 className="text-sm font-medium mb-1 text-white">
                  {availableStudies.find(st => st.studyInstanceUid === selectedStudyUID)?.description || 'Study'}
                </h4>
                <p className="text-xs text-muted-foreground mb-3">
                  Select series to send for AI analysis
                </p>

                {availableSeries.length > 0 ? (
                  <SeriesSelector
                    series={availableSeries}
                    selectedSeriesUIDs={selectedSeriesUIDs}
                    onToggleSeries={handleSeriesToggle}
                    onSelectAll={handleSelectAll}
                    onClearSelection={handleClearSelection}
                  />
                ) : (
                  <div className="text-sm text-muted-foreground p-3 bg-secondary-dark rounded">
                    No original series available for this study (only AI results found)
                  </div>
                )}
              </div>

              <div className="text-xs text-muted-foreground p-2 bg-secondary-dark rounded">
                ℹ️ Only original series are shown. AI results (SR/SC) are excluded.
              </div>
            </div>

            <div className="p-4 border-t border-secondary-light space-y-2">
              <Button
                onClick={handleSeriesConfirmed}
                disabled={selectedSeriesUIDs.size === 0}
                className="w-full"
              >
                Next: Select AI Model →
              </Button>
              <Button
                onClick={goToPrevStep}
                variant="outlined"
                className="w-full"
              >
                ← Back to Studies
              </Button>
            </div>
          </div>
        );

      case 3:
        // Step 3: Select AI Endpoint
        return (
          <div className="flex-1 flex flex-col">
            <div className="flex-1 p-4 space-y-4 overflow-y-auto">
              {error && (
                <div className="rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700">
                  {error}
                </div>
              )}

              <div>
                <h4 className="text-sm font-medium mb-3 text-muted-foreground">
                  Configure AI endpoint for analysis
                </h4>
                <AIEndpointConfig
                  onEndpointChange={handleEndpointChange}
                  currentEndpoint={currentEndpoint}
                />
              </div>

              <div className="text-sm bg-secondary-dark rounded p-3 space-y-2">
                <div className="text-white font-medium">Summary:</div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <div>• Study: {availableStudies.find(st => st.studyInstanceUid === selectedStudyUID)?.description}</div>
                  <div>• Series: {selectedSeriesUIDs.size} selected</div>
                  <div>• Endpoint: {currentEndpoint?.name || 'Not configured'}</div>
                </div>
              </div>
            </div>

            <div className="p-4 border-t border-secondary-light space-y-2">
              <Button
                onClick={handleRouteToAI}
                disabled={!currentEndpoint}
                className="w-full"
              >
                ⚡ Send to AI
              </Button>
              <Button
                onClick={goToPrevStep}
                variant="outlined"
                className="w-full"
              >
                ← Back to Series
              </Button>
            </div>
          </div>
        );

      case 4:
        // Step 4: Progress / Results
        return (
          <div className="flex-1 flex flex-col">
            <div className="flex-1 p-4 space-y-4 overflow-y-auto flex items-center justify-center">
              <div className="w-full max-w-md space-y-4">
                {error && (
                  <div className="rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700">
                    {error}
                  </div>
                )}

                {!error && (
                  <>
                    <div className="text-center">
                      <div className="text-lg font-medium text-white mb-2">
                        {status === 'routing' && 'Sending to AI...'}
                        {status === 'checking' && 'Awaiting AI Results...'}
                        {status === 'refreshing' && 'Loading Results...'}
                        {status === 'idle' && progress === 100 && '✅ Complete!'}
                      </div>
                    </div>

                    <div className="p-4 border border-secondary-light rounded bg-secondary-dark">
                      <ProgressLoadingBar progress={progress} />
                      <div className="text-xs text-right text-muted-foreground mt-2">
                        {progress}%
                      </div>
                    </div>

                    <div className="text-sm text-muted-foreground text-center">
                      {status === 'routing' && 'Uploading series to AI server...'}
                      {status === 'checking' && 'AI analysis in progress. Results will appear automatically.'}
                      {status === 'refreshing' && 'Fetching AI results...'}
                      {status === 'idle' && progress === 100 && 'AI analysis complete. Check the study browser for results.'}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="p-4 border-t border-secondary-light">
              {(status === 'idle' || error) && (
                <Button
                  onClick={resetWizard}
                  className="w-full"
                >
                  ← Start New Analysis
                </Button>
              )}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Fixed header */}
      <div className="p-4 border-b border-secondary-light">
        <div className="flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">AI Analysis</h3>
          <div className="text-xs text-muted-foreground">
            Step {currentStep} of 4
          </div>
        </div>
      </div>

      {/* Step content */}
      {renderStepContent()}
    </div>
  );
};

export default AIRoutingPanel;
