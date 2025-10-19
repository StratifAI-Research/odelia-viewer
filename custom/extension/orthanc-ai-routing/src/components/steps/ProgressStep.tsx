import React from 'react';
import { Button } from '@ohif/ui';

interface ProgressStepProps {
  status: 'idle' | 'routing' | 'checking' | 'refreshing';
  progress: number;
  error?: string | null;
  onReset: () => void;
  ProgressLoadingBar: React.ComponentType<{ progress: number }>;
}

export const ProgressStep: React.FC<ProgressStepProps> = ({
  status,
  progress,
  error,
  onReset,
  ProgressLoadingBar,
}) => {
  const isComplete = status === 'idle' && progress === 100;
  const canReset = status === 'idle' || error;

  const getStatusTitle = () => {
    if (error) return '❌ Error';
    if (status === 'routing') return 'Sending to AI...';
    if (status === 'checking') return 'Awaiting AI Results...';
    if (status === 'refreshing') return 'Loading Results...';
    if (isComplete) return '✅ Complete!';
    return '';
  };

  const getStatusMessage = () => {
    if (error) return null;
    if (status === 'routing') return 'Uploading series to AI server...';
    if (status === 'checking') return 'AI analysis in progress. Results will appear automatically.';
    if (status === 'refreshing') return 'Fetching AI results...';
    if (isComplete) return 'AI analysis complete. Check the study browser for results.';
    return null;
  };

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 p-4 space-y-4 overflow-y-auto flex items-center justify-center">
        <div className="w-full max-w-md space-y-4">
          {error && (
            <div className="rounded border border-red-400 bg-red-100 px-4 py-3 text-red-700">
              {error}
            </div>
          )}

          {!error && (
            <>
              <div className="text-center">
                <div className="text-lg font-medium text-white mb-2">
                  {getStatusTitle()}
                </div>
              </div>

              <div className="p-4 border border-secondary-light rounded bg-secondary-dark">
                <ProgressLoadingBar progress={progress} />
                <div className="text-xs text-right text-muted-foreground mt-2">
                  {progress}%
                </div>
              </div>

              {getStatusMessage() && (
                <div className="text-sm text-muted-foreground text-center">
                  {getStatusMessage()}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <div className="p-4 border-t border-secondary-light">
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
