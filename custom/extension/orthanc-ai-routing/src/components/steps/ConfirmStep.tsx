import React from 'react';
import { Button } from '@ohif/ui-next';
import type { AIEndpoint } from '../AIEndpointConfig';
import { ErrorMessage } from '../LoadingStates';

interface ConfirmStepProps {
  currentEndpoint: AIEndpoint | null;
  studyDescription: string;
  selectedSeriesCount: number;
  inputMappingDescription?: string | null;
  /**
   * Set when this model publishes an input specification but the role mapping no
   * longer satisfies it. Send is blocked rather than degraded: see the note in
   * AIRoutingPanel.handleSendToAI.
   */
  mappingIncomplete?: boolean;
  onSend: () => void;
  onBack: () => void;
  error?: string | null;
}

export const ConfirmStep: React.FC<ConfirmStepProps> = ({
  currentEndpoint,
  studyDescription,
  selectedSeriesCount,
  inputMappingDescription,
  mappingIncomplete = false,
  onSend,
  onBack,
  error,
}) => {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-3 pt-4 pb-4">
        {error && <ErrorMessage>{error}</ErrorMessage>}

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

        {mappingIncomplete && (
          <ErrorMessage>
            This model needs each input role assigned to a series, and the mapping is no longer
            complete. Go back and reassign it — sending now would let the server choose the roles
            itself.
          </ErrorMessage>
        )}
      </div>

      <div className="border-input bg-background flex-shrink-0 space-y-2 border-t px-3 py-3">
        <Button
          onClick={onSend}
          disabled={!currentEndpoint || mappingIncomplete}
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
