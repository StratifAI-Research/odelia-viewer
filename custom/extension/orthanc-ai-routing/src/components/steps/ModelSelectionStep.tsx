import React, { useEffect, useState, useCallback } from 'react';
import { Button } from '@ohif/ui-next';
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-3 pt-4 pb-4">
        {(error || manifestError) && (
          <div className="rounded border border-red-400 bg-red-100 px-4 py-3 text-sm text-red-700">
            {error || manifestError}
          </div>
        )}

        <div>
          <h4 className="text-muted-foreground mb-3 text-sm font-medium">Select AI Model</h4>
          <AIEndpointConfig
            onEndpointChange={handleEndpointChange}
            currentEndpoint={currentEndpoint}
            compact
          />
        </div>

        {isLoadingManifest && (
          <div className="bg-muted text-muted-foreground rounded p-3 text-xs">
            <div className="flex items-center space-x-2">
              <div className="border-primary h-4 w-4 animate-spin rounded-full border-2 border-t-transparent" />
              <span>Fetching model configuration...</span>
            </div>
          </div>
        )}

        {manifestChecked && manifest && (
          <div className="bg-muted space-y-2 rounded p-3 text-sm">
            <div className="text-foreground font-medium">{manifest.model_name}</div>
            <div className="text-muted-foreground space-y-1 text-xs">
              <div>Version: {manifest.version}</div>
              <div>Input modes: {manifest.input_configurations.map(c => c.name).join(', ')}</div>
            </div>
          </div>
        )}

        {manifestChecked && !manifest && (
          <div className="bg-muted space-y-1 rounded p-3 text-sm">
            <div className="text-muted-foreground text-xs">
              No input specification available for this model.
            </div>
          </div>
        )}
      </div>

      <div className="border-input bg-background flex-shrink-0 border-t px-3 py-3">
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
