import React from 'react';
import { Button } from '@ohif/ui-next';

interface ProgressStepProps {
  status: 'idle' | 'routing' | 'checking';
  progress: number;
  error?: string | null;
  progressDescription?: string | null;
  onReset: () => void;
  ProgressLoadingBar: React.ComponentType<{ progress: number }>;
}

export const ProgressStep: React.FC<ProgressStepProps> = ({
  status,
  progress,
  error,
  progressDescription,
  onReset,
  ProgressLoadingBar,
}) => {
  const isComplete = status === 'idle' && progress === 100;
  const canReset = status === 'idle' || error;

  const getStatusTitle = () => {
    if (error) {
      return '❌ Error';
    }
    if (status === 'routing') {
      return 'Sending to AI...';
    }
    if (status === 'checking') {
      return 'Awaiting AI Results...';
    }
    if (isComplete) {
      return '✅ Complete!';
    }
    return '';
  };

  const getStatusMessage = () => {
    if (error) {
      return null;
    }

    // Use progressDescription if available (from workitem)
    if (progressDescription) {
      return progressDescription;
    }

    // Fallback to default messages
    if (status === 'routing') {
      return 'Uploading series to AI server...';
    }
    if (status === 'checking') {
      return 'AI analysis in progress. Results will appear automatically.';
    }
    if (isComplete) {
      return 'AI analysis complete. Check the study browser for results.';
    }
    return null;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex min-h-0 flex-1 items-center justify-center space-y-4 overflow-y-auto p-4">
        <div className="w-full max-w-md space-y-4">
          {error && (
            <div className="rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700">
              {error}
            </div>
          )}

          {!error && (
            <>
              <div className="text-center">
                <div className="text-foreground mb-2 text-lg font-medium">{getStatusTitle()}</div>
              </div>

              <div className="border-input bg-muted rounded border p-4">
                <ProgressLoadingBar progress={progress} />
                <div className="text-muted-foreground mt-2 text-right text-xs">{progress}%</div>
              </div>

              {getStatusMessage() && (
                <div className="text-muted-foreground text-center text-sm">
                  {getStatusMessage()}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="border-input flex-shrink-0 border-t p-4">
        {canReset && (
          <Button
            onClick={onReset}
            className="w-full"
          >
            ← Start New Analysis
          </Button>
        )}
      </div>
    </div>
  );
};
