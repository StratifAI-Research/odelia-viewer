import { useState } from 'react';
import OrthancAIService from '../services/OrthancAIService';
import type { InputMapping } from '../services/OrthancAIService';
import { AIEndpoint } from '../components/AIEndpointConfig';

interface UseAIRoutingProps {
  orthancAIService: OrthancAIService;
  uiNotificationService: any;
  onComplete?: () => void;
}

export function useAIRouting({
  orthancAIService,
  uiNotificationService,
  onComplete
}: UseAIRoutingProps) {
  const [status, setStatus] = useState<'idle' | 'routing' | 'checking' | 'refreshing'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<number>(0);
  const [currentEndpoint, setCurrentEndpoint] = useState<AIEndpoint | null>(null);
  const [workitemUid, setWorkitemUid] = useState<string | null>(null);
  const [progressDescription, setProgressDescription] = useState<string | null>(null);

  // Load current endpoint on mount
  useState(() => {
    const endpoint = orthancAIService.getCurrentEndpoint();
    setCurrentEndpoint(endpoint);
  });

  const handleEndpointChange = (endpoint: AIEndpoint) => {
    setCurrentEndpoint(endpoint);
    orthancAIService.setCurrentEndpoint(endpoint);

    uiNotificationService.show({
      title: 'AI Endpoint Changed',
      message: `Using AI endpoint: ${endpoint.name}`,
      type: 'info',
      duration: 3000,
    });
  };

  const handleWorkitemStatusUpdate = (workitemStatus: any) => {
    console.log('Workitem status update:', workitemStatus);

    // Map workitem states to local status
    switch (workitemStatus.state) {
      case 'SCHEDULED':
        setStatus('routing');
        setProgress(10);
        setProgressDescription('Workitem scheduled, waiting to start...');
        break;

      case 'IN_PROGRESS':
        setStatus('checking');
        // Use workitem progress if available, otherwise keep current
        if (workitemStatus.progress !== undefined) {
          setProgress(workitemStatus.progress);
        }
        // Use workitem progress description if available
        if (workitemStatus.progressDescription) {
          setProgressDescription(workitemStatus.progressDescription);
        } else {
          setProgressDescription('AI analysis in progress...');
        }
        break;

      case 'COMPLETED':
        setStatus('idle');
        setProgress(100);
        setProgressDescription('Analysis complete!');

        uiNotificationService.show({
          title: 'AI Analysis Complete',
          message: 'AI analysis has been completed successfully',
          type: 'success',
          duration: 5000,
        });

        if (onComplete) {
          onComplete();
        }
        break;

      case 'CANCELED':
        setStatus('idle');
        const errorMsg = workitemStatus.cancellationReason || 'Workitem was canceled';
        setError(errorMsg);
        setProgressDescription(null);

        uiNotificationService.show({
          title: 'AI Analysis Canceled',
          message: errorMsg,
          type: 'error',
          duration: 5000,
        });
        break;

      default:
        console.warn('Unknown workitem state:', workitemStatus.state);
    }
  };

  const sendToAI = async (
    studyUID: string,
    seriesUIDs: string[],
    inputMapping?: InputMapping,
    inputConfigurationId?: string
  ) => {
    if (!currentEndpoint) {
      setError('No AI endpoint configured. Please add an AI endpoint first.');
      return false;
    }

    if (seriesUIDs.length === 0) {
      setError('No series selected');
      return false;
    }

    try {
      setStatus('routing');
      setError(null);
      setProgress(10);
      setProgressDescription('Sending study to AI endpoint...');

      const response = await orthancAIService.routeSeriesToAI(
        studyUID,
        seriesUIDs,
        inputMapping,
        inputConfigurationId
      );

      if (response.status === 'success') {
        // Capture workitem UID from response
        const receivedWorkitemUid = response.workitem_uid;

        if (receivedWorkitemUid) {
          setWorkitemUid(receivedWorkitemUid);
          setStatus('checking');
          setError(null);
          setProgress(15);
          setProgressDescription('Workitem created, waiting for processing...');

          uiNotificationService.show({
            title: 'Study Sent for AI Analysis',
            message: 'The study has been sent for AI analysis. Monitoring progress...',
            type: 'info',
            duration: 5000,
          });

          // Start polling for workitem status updates (every 2 seconds)
          orthancAIService.startWorkitemPolling(
            receivedWorkitemUid,
            handleWorkitemStatusUpdate,
            2000
          );
          return true;
        } else {
          console.warn('No workitem_uid in response, falling back to old behavior');
          setStatus('checking');
          setError(null);
          setProgress(50);
          setProgressDescription('Processing started...');

          uiNotificationService.show({
            title: 'Study Sent for AI Analysis',
            message: 'The study has been sent for AI analysis.',
            type: 'info',
            duration: 5000,
          });
          return true;
        }
      } else if (response.status === 'error') {
        setError(response.message || 'Unknown error');
        setStatus('idle');
        setProgressDescription(null);

        uiNotificationService.show({
          title: 'AI Analysis Failed',
          message: response.message || 'Failed to send study for AI analysis',
          type: 'error',
          duration: 5000,
        });
        return false;
      } else {
        setStatus('idle');
        setProgressDescription(null);
        return false;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send study for AI analysis';
      setError(errorMessage);
      setStatus('idle');
      setProgress(0);
      setProgressDescription(null);

      uiNotificationService.show({
        title: 'AI Analysis Failed',
        message: errorMessage,
        type: 'error',
        duration: 5000,
      });
      return false;
    }
  };

  const reset = () => {
    // Stop any active workitem polling
    orthancAIService.stopWorkitemPolling();

    setStatus('idle');
    setProgress(0);
    setError(null);
    setWorkitemUid(null);
    setProgressDescription(null);
  };

  return {
    // State
    status,
    error,
    progress,
    currentEndpoint,
    workitemUid,
    progressDescription,

    // Actions
    sendToAI,
    handleEndpointChange,
    reset,
  };
}
