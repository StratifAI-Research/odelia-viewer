import React, { useState, useEffect } from 'react';
import { Button } from '@ohif/ui';
import { requestDisplaySetCreationForStudy } from '@ohif/extension-default';
import OrthancAIService from '../services/OrthancAIService';
import AIEndpointConfig, { AIEndpoint } from './AIEndpointConfig';

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
  const [status, setStatus] = useState<'idle' | 'routing' | 'checking' | 'refreshing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [currentEndpoint, setCurrentEndpoint] = useState<AIEndpoint | null>(null);

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
    console.log('New AI results detected!');
    setStatus('idle');
    setProgress(100);

    // Show completion message
    uiNotificationService.show({
      title: 'AI Results Ready',
      message: 'New AI results have been loaded',
      type: 'success',
      duration: 5000,
    });
  };

  const handleRouteToAI = async () => {
    if (!dicomStudyUID) {
      setError('No study selected or no StudyInstanceUID in URL');
      return;
    }

    if (!currentEndpoint) {
      setError('No AI endpoint configured. Please add an AI endpoint first.');
      return;
    }

    try {
      setStatus('routing');
      setError(null);
      setProgress(10);

      // Start a progress animation
      const progressInterval = setInterval(() => {
        setProgress(prevProgress => {
          // Cap at 90% until we get actual completion
          const newProgress = prevProgress + 5;
          return newProgress > 90 ? 90 : newProgress;
        });
      }, 1000);

      // Use the new method that extracts the StudyInstanceUID from the URL
      const response = await orthancAIService.routeCurrentStudyToAI();

      // Clear the interval
      clearInterval(progressInterval);
      setProgress(95);

      // Start checking for new AI results
      if (response.status === 'success') {
        setStatus('checking');
        setError(null);

        // Show notification
        uiNotificationService.show({
          title: 'Study Sent for AI Processing',
          message: 'The study has been sent for AI processing. Results will appear automatically when ready.',
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
          title: 'AI Routing Failed',
          message: response.message || 'Failed to route study to AI',
          type: 'error',
          duration: 5000,
        });
      } else {
        setStatus('idle');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to route study to AI');
      setStatus('idle');
      setProgress(0);

      // Show error notification
      uiNotificationService.show({
        title: 'AI Routing Failed',
        message: err instanceof Error ? err.message : 'Failed to route study to AI',
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

  return (
    <div className="p-4">
      <h3 className="mb-4 text-lg font-semibold">AI Routing Panel</h3>

      {/* AI Endpoint Configuration */}
      <div className="mb-4">
        <h4 className="text-sm font-medium mb-2">AI Endpoint Configuration</h4>
        <AIEndpointConfig
          onEndpointChange={handleEndpointChange}
          currentEndpoint={currentEndpoint}
        />
      </div>

      {error && (
        <div className="mb-4 rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700">
          {error}
        </div>
      )}

      {/* Status and progress section */}
      {(status === 'routing' || status === 'checking' || status === 'refreshing') && (
        <div className="mb-4 p-3 border rounded bg-gray-50">
          <div className="mb-2">
            <ProgressLoadingBar progress={progress} />
            <div className="text-xs text-right text-gray-500 mt-1">{progress}%</div>
          </div>
          <p className="text-sm text-gray-600">
            {status === 'routing' && 'Routing study to AI endpoint...'}
            {status === 'checking' && 'Waiting for AI results...'}
            {status === 'refreshing' && 'Loading new AI results...'}
          </p>
        </div>
      )}

      <Button
        onClick={handleRouteToAI}
        disabled={status !== 'idle' || !dicomStudyUID || !currentEndpoint}
        className="w-full"
      >
        Route to AI
      </Button>

      {dicomStudyUID ? (
        <p className="mt-2 text-xs text-gray-500 break-all">
          DICOM Study UID: {dicomStudyUID}
        </p>
      ) : (
        <p className="mt-2 text-xs text-red-500">Could not find StudyInstanceUID in URL</p>
      )}
    </div>
  );
};

export default AIRoutingPanel;
