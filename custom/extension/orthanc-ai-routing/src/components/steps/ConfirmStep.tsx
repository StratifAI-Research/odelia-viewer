import React from 'react';
import { Button } from '@ohif/ui-next';
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
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-3 pt-4 pb-4">
        {error && (
          <div className="rounded border border-red-400 bg-red-100 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <h4 className="text-muted-foreground text-sm font-medium">Confirm &amp; Run</h4>

        <div className="bg-muted space-y-2 rounded p-3 text-sm">
          <div className="text-foreground font-medium">Summary</div>
          <div className="text-muted-foreground space-y-1 text-xs">
            <div>&bull; Model: {currentEndpoint?.name || 'Not configured'}</div>
            <div>&bull; Study: {studyDescription}</div>
            <div>&bull; Series: {selectedSeriesCount} selected</div>
          </div>
        </div>

        {inputMappingDescription && (
          <div className="bg-muted space-y-2 rounded p-3 text-sm">
            <div className="text-foreground font-medium">Input Mapping</div>
            <div className="text-muted-foreground whitespace-pre-line text-xs">
              {inputMappingDescription}
            </div>
          </div>
        )}
      </div>

      <div className="border-input bg-background flex-shrink-0 space-y-2 border-t px-3 py-3">
        <Button
          onClick={onSend}
          disabled={!currentEndpoint}
          className="w-full"
        >
          Send to AI
        </Button>
        <Button
          onClick={onBack}
          variant="outline"
          className="w-full"
        >
          &larr; Back
        </Button>
      </div>
    </div>
  );
};
