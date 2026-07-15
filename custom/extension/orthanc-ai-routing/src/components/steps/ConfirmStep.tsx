import React from 'react';
import { Button } from '@ohif/ui';
import type { AIEndpoint } from '../AIEndpointConfig';

interface ConfirmStepProps {
  currentEndpoint: AIEndpoint | null;
  studyDescription: string;
  selectedSeriesCount: number;
  inputMappingDescription?: string | null;
  onSend: () => void;
  onBack: () => void;
  error?: string | null;
}

export const ConfirmStep: React.FC<ConfirmStepProps> = ({
  currentEndpoint,
  studyDescription,
  selectedSeriesCount,
  inputMappingDescription,
  onSend,
  onBack,
  error,
}) => {
  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 min-h-0 px-3 pt-4 pb-4 space-y-4 overflow-y-auto overflow-x-hidden">
        {error && (
          <div className="rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700 text-sm">
            {error}
          </div>
        )}

        <h4 className="text-sm font-medium text-muted-foreground">
          Confirm &amp; Run
        </h4>

        <div className="text-sm bg-secondary-dark rounded p-3 space-y-2">
          <div className="text-white font-medium">Summary</div>
          <div className="text-xs text-muted-foreground space-y-1">
            <div>&bull; Model: {currentEndpoint?.name || 'Not configured'}</div>
            <div>&bull; Study: {studyDescription}</div>
            <div>&bull; Series: {selectedSeriesCount} selected</div>
          </div>
        </div>

        {inputMappingDescription && (
          <div className="text-sm bg-secondary-dark rounded p-3 space-y-2">
            <div className="text-white font-medium">Input Mapping</div>
            <div className="text-xs text-muted-foreground whitespace-pre-line">
              {inputMappingDescription}
            </div>
          </div>
        )}
      </div>

      <div className="flex-shrink-0 px-3 py-3 border-t border-secondary-light bg-black space-y-2">
        <Button
          onClick={onSend}
          disabled={!currentEndpoint}
          className="w-full"
        >
          Send to AI
        </Button>
        <Button
          onClick={onBack}
          variant="outlined"
          className="w-full"
        >
          &larr; Back
        </Button>
      </div>
    </div>
  );
};
