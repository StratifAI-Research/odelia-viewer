import React from 'react';
import { Button } from '@ohif/ui';
import AIEndpointConfig, { AIEndpoint } from '../AIEndpointConfig';

interface EndpointSelectionStepProps {
  currentEndpoint: AIEndpoint | null;
  onEndpointChange: (endpoint: AIEndpoint) => void;
  studyDescription: string;
  selectedSeriesCount: number;
  onSend: () => void;
  onBack: () => void;
  error?: string | null;
}

export const EndpointSelectionStep: React.FC<EndpointSelectionStepProps> = ({
  currentEndpoint,
  onEndpointChange,
  studyDescription,
  selectedSeriesCount,
  onSend,
  onBack,
  error,
}) => {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 min-h-0 p-4 space-y-4 overflow-y-auto">
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
            onEndpointChange={onEndpointChange}
            currentEndpoint={currentEndpoint}
          />
        </div>

        <div className="text-sm bg-secondary-dark rounded p-3 space-y-2">
          <div className="text-white font-medium">Summary:</div>
          <div className="text-xs text-muted-foreground space-y-1">
            <div>• Study: {studyDescription}</div>
            <div>• Series: {selectedSeriesCount} selected</div>
            <div>• Endpoint: {currentEndpoint?.name || 'Not configured'}</div>
          </div>
        </div>
      </div>

      <div className="flex-shrink-0 p-4 border-t border-secondary-light space-y-2">
        <Button
          onClick={onSend}
          disabled={!currentEndpoint}
          className="w-full"
        >
          ⚡ Send to AI
        </Button>
        <Button
          onClick={onBack}
          variant="outlined"
          className="w-full"
        >
          ← Back to Series
        </Button>
      </div>
    </div>
  );
};
