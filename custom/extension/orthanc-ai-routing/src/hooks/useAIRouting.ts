import { useState } from 'react';
import OrthancAIService from '../services/OrthancAIService';
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

  const handleNewAIResults = () => {
    console.log('New AI analysis results detected!');
    setStatus('idle');
    setProgress(100);

    uiNotificationService.show({
      title: 'AI Analysis Results Ready',
      message: 'New AI analysis results have been loaded',
      type: 'success',
      duration: 5000,
    });

    if (onComplete) {
      onComplete();
    }
  };

  const sendToAI = async (studyUID: string, seriesUIDs: string[]) => {
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
      setProgress(20);

      // Start a progress animation
      const progressInterval = setInterval(() => {
        setProgress(prev => {
          if (prev < 40) {
            return prev + 4 >= 40 ? 40 : prev + 4;
          }
          const next = prev + 1;
          return next > 80 ? 80 : next;
        });
      }, 2000);

      // Send selected series to AI
      const response = await orthancAIService.routeSeriesToAI(studyUID, seriesUIDs);

      clearInterval(progressInterval);
      setProgress(prev => (prev < 45 ? 45 : prev));

      if (response.status === 'success') {
        setStatus('checking');
        setError(null);

        uiNotificationService.show({
          title: 'Study Sent for AI Analysis',
          message: 'The study has been sent for AI analysis. Results will appear automatically when ready.',
          type: 'info',
          duration: 5000,
        });

        // Start polling for new series
        orthancAIService.startRefreshCheck(handleNewAIResults);
        return true;
      } else if (response.status === 'error') {
        setError(response.message || 'Unknown error');
        setStatus('idle');

        uiNotificationService.show({
          title: 'AI Analysis Failed',
          message: response.message || 'Failed to send study for AI analysis',
          type: 'error',
          duration: 5000,
        });
        return false;
      } else {
        setStatus('idle');
        return false;
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send study for AI analysis';
      setError(errorMessage);
      setStatus('idle');
      setProgress(0);

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
    setStatus('idle');
    setProgress(0);
    setError(null);
  };

  return {
    // State
    status,
    error,
    progress,
    currentEndpoint,

    // Actions
    sendToAI,
    handleEndpointChange,
    reset,
  };
}
