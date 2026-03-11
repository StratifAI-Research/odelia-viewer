import React, { useEffect, useState, useCallback } from 'react';
import { Button } from '@ohif/ui';
import AIEndpointConfig, { AIEndpoint } from '../AIEndpointConfig';
import OrthancAIService from '../../services/OrthancAIService';
import type { ModelManifest } from '../../services/OrthancAIService';

interface ModelSelectionStepProps {
  orthancAIService: OrthancAIService;
  currentEndpoint: AIEndpoint | null;
  onEndpointChange: (endpoint: AIEndpoint) => void;
  manifest: ModelManifest | null;
  onManifestLoaded: (manifest: ModelManifest | null) => void;
  onNext: () => void;
  error?: string | null;
}

export const ModelSelectionStep: React.FC<ModelSelectionStepProps> = ({
  orthancAIService,
  currentEndpoint,
  onEndpointChange,
  manifest,
  onManifestLoaded,
  onNext,
  error,
}) => {
  const [isLoadingManifest, setIsLoadingManifest] = useState(false);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const [manifestChecked, setManifestChecked] = useState(false);

  const fetchManifest = useCallback(
    async (endpoint: AIEndpoint) => {
      setIsLoadingManifest(true);
      setManifestError(null);
      try {
        const result = await orthancAIService.getModelManifest(endpoint.url);
        onManifestLoaded(result);
        setManifestChecked(true);
      } catch (err) {
        console.error('Error fetching manifest:', err);
        setManifestError('Failed to fetch model configuration');
        onManifestLoaded(null);
        setManifestChecked(true);
      } finally {
        setIsLoadingManifest(false);
      }
    },
    [orthancAIService, onManifestLoaded]
  );

  const handleEndpointChange = useCallback(
    (endpoint: AIEndpoint) => {
      onEndpointChange(endpoint);
      orthancAIService.clearManifestCache();
      setManifestChecked(false);
      onManifestLoaded(null);
      fetchManifest(endpoint);
    },
    [onEndpointChange, orthancAIService, fetchManifest, onManifestLoaded]
  );

  useEffect(() => {
    if (currentEndpoint && !manifestChecked && !isLoadingManifest) {
      fetchManifest(currentEndpoint);
    }
  }, [currentEndpoint, manifestChecked, isLoadingManifest, fetchManifest]);

  const canProceed = currentEndpoint && !isLoadingManifest && manifestChecked;

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 min-h-0 px-3 pt-4 pb-4 space-y-4 overflow-y-auto overflow-x-hidden">
        {(error || manifestError) && (
          <div className="rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700 text-sm">
            {error || manifestError}
          </div>
        )}

        <div>
          <h4 className="text-sm font-medium mb-3 text-muted-foreground">
            Select AI Model
          </h4>
          <AIEndpointConfig
            onEndpointChange={handleEndpointChange}
            currentEndpoint={currentEndpoint}
            compact
          />
        </div>

        {isLoadingManifest && (
          <div className="p-3 bg-secondary-dark rounded text-xs text-muted-foreground">
            <div className="flex items-center space-x-2">
              <div className="animate-spin h-4 w-4 border-2 border-primary-light border-t-transparent rounded-full" />
              <span>Fetching model configuration...</span>
            </div>
          </div>
        )}

        {manifestChecked && manifest && (
          <div className="text-sm bg-secondary-dark rounded p-3 space-y-2">
            <div className="text-white font-medium">{manifest.model_name}</div>
            <div className="text-xs text-muted-foreground space-y-1">
              <div>Version: {manifest.version}</div>
              <div>
                Input modes: {manifest.input_configurations.map(c => c.name).join(', ')}
              </div>
            </div>
          </div>
        )}

        {manifestChecked && !manifest && (
          <div className="text-sm bg-secondary-dark rounded p-3 space-y-1">
            <div className="text-muted-foreground text-xs">
              No input specification available for this model.
            </div>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 px-3 py-3 border-t border-secondary-light bg-black">
        <Button
          onClick={onNext}
          disabled={!canProceed}
          className="w-full"
        >
          {manifest ? 'Next: Select Input Mode \u2192' : 'Next: Select Series \u2192'}
        </Button>
      </div>
    </div>
  );
};
