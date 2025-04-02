import React, { useEffect, useState, useCallback } from 'react';
import { Button, LoadingIndicatorProgress } from '@ohif/ui';
import OrthancAIService from '../services/OrthancAIService';
import { ViewportGridService } from '@ohif/core';

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
  };
}

interface AIRoutingPanelProps {
  servicesManager: ServicesManager;
}

const AIRoutingPanel: React.FC<AIRoutingPanelProps> = ({ servicesManager }) => {
  const [status, setStatus] = useState<'idle' | 'routing' | 'checking'>('idle');
  const [routingStatus, setRoutingStatus] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [studyInstanceUID, setStudyInstanceUID] = useState<string | null>(null);

  const updateStudyInstanceUID = useCallback(() => {
    const viewportGridService = servicesManager.services.viewportGridService;
    if (!viewportGridService) {
      console.warn('Viewport grid service not found');
      return;
    }

    const state = viewportGridService.getState();
    const activeViewportId = state.activeViewportId;

    if (!activeViewportId) {
      console.warn('No active viewport');
      return;
    }

    const viewport = state.viewports.get(activeViewportId);
    if (!viewport) {
      console.warn('No viewport data found for active viewport');
      return;
    }

    const displaySetInstanceUIDs = viewport.displaySetInstanceUIDs;
    if (!displaySetInstanceUIDs || displaySetInstanceUIDs.length === 0) {
      console.warn('No display set instance UIDs in active viewport');
      setStudyInstanceUID(null);
      return;
    }

    // Get the first display set instance UID
    const displaySetInstanceUID = displaySetInstanceUIDs[0];
    console.info('Display set instance UID:', displaySetInstanceUID);
    setStudyInstanceUID(displaySetInstanceUID);
  }, [servicesManager]);

  useEffect(() => {
    const viewportGridService = servicesManager.services.viewportGridService;
    if (!viewportGridService) {
      console.warn('Viewport grid service not found');
      return;
    }

    // Subscribe to viewport events
    const subscriptions = [
      viewportGridService.subscribe(
        viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
        () => {
          setTimeout(updateStudyInstanceUID, 0);
        }
      ),
      viewportGridService.subscribe(
        viewportGridService.EVENTS.GRID_STATE_CHANGED,
        () => {
          setTimeout(updateStudyInstanceUID, 0);
        }
      ),
      viewportGridService.subscribe(
        viewportGridService.EVENTS.VIEWPORTS_READY,
        () => {
          setTimeout(updateStudyInstanceUID, 0);
        }
      ),
    ];

    // Initial update
    updateStudyInstanceUID();

    return () => {
      subscriptions.forEach(subscription => subscription.unsubscribe());
    };
  }, [servicesManager, updateStudyInstanceUID]);

  const handleRouteToAI = async () => {
    if (!studyInstanceUID) {
      setError('No study selected');
      return;
    }

    try {
      setStatus('routing');
      setError(null);
      const response = await servicesManager.services.orthancAIService.routeStudyToAI(studyInstanceUID);
      setRoutingStatus(response);
      setStatus('checking');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to route study to AI');
      setStatus('idle');
    }
  };

  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (status === 'checking' && studyInstanceUID) {
      const checkStatus = async () => {
        try {
          const status = await servicesManager.services.orthancAIService.getRoutingStatus(studyInstanceUID);
          setRoutingStatus(status);
          if (status.status === 'completed' || status.status === 'failed') {
            clearInterval(interval);
            setStatus('idle');
          }
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Failed to check routing status');
          clearInterval(interval);
          setStatus('idle');
        }
      };

      interval = setInterval(checkStatus, 5000);
    }

    return () => {
      if (interval) {
        clearInterval(interval);
      }
    };
  }, [status, studyInstanceUID]);

  return (
    <div className="p-4">
      <h3 className="mb-4 text-lg font-semibold">AI Routing Panel</h3>

      {error && (
        <div className="mb-4 rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700">
          {error}
        </div>
      )}

      {status === 'routing' && (
        <div className="mb-4">
          <LoadingIndicatorProgress />
          <p className="mt-2 text-sm text-gray-600">Routing study to AI endpoint...</p>
        </div>
      )}

      {status === 'checking' && routingStatus && (
        <div className="mb-4">
          <LoadingIndicatorProgress />
          <p className="mt-2 text-sm text-gray-600">
            Status: {routingStatus.status}
            {routingStatus.message && ` - ${routingStatus.message}`}
          </p>
        </div>
      )}

      {routingStatus?.status === 'completed' && (
        <div className="mb-4 rounded border border-green-400 bg-green-100 px-4 py-3 text-green-700">
          Routing completed successfully!
        </div>
      )}

      {routingStatus?.status === 'failed' && (
        <div className="mb-4 rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700">
          Routing failed: {routingStatus.message}
        </div>
      )}

      <Button
        onClick={handleRouteToAI}
        disabled={status === 'routing' || status === 'checking' || !studyInstanceUID}
        className="w-full"
      >
        Route to AI
      </Button>
    </div>
  );
};

export default AIRoutingPanel;
