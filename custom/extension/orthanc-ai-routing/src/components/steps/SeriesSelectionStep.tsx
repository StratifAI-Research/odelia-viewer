import React from 'react';
import { Button } from '@ohif/ui-next';
import SeriesSelector, { SeriesInfo } from '../SeriesSelector';
import { SeriesListSkeleton, EmptyState, ErrorState } from '../LoadingStates';

interface SeriesSelectionStepProps {
  series: SeriesInfo[];
  selectedSeriesUIDs: Set<string>;
  onToggleSeries: (seriesUID: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onNext: () => void;
  onBack?: () => void; // Optional - kept for compatibility but won't be used
  onRetry?: () => void; // Retry loading series on error
  isLoading?: boolean;
  error?: string | null;
}

export const SeriesSelectionStep: React.FC<SeriesSelectionStepProps> = ({
  series,
  selectedSeriesUIDs,
  onToggleSeries,
  onSelectAll,
  onClearSelection,
  onNext,
  onBack,
  onRetry,
  isLoading,
  error,
}) => {
  const renderContent = () => {
    if (error) {
      return (
        <ErrorState
          title="Failed to Load Series"
          message={error}
          onRetry={onRetry}
        />
      );
    }

    if (isLoading) {
      return (
        <div className="space-y-3">
          <p className="text-muted-foreground text-xs">Loading series from display sets...</p>
          <div className="bg-muted text-muted-foreground rounded p-2 text-xs">
            <div className="flex items-center space-x-2">
              <div className="border-primary h-4 w-4 animate-spin rounded-full border-2 border-t-transparent"></div>
              <span>Waiting for DICOM data...</span>
            </div>
          </div>
          <SeriesListSkeleton />
        </div>
      );
    }

    if (series.length === 0) {
      return (
        <EmptyState
          icon="🔍"
          title="No Series Available"
          message="This study contains only AI results. No original series available to send."
        />
      );
    }

    return (
      <div className="space-y-3">
        <p className="text-muted-foreground text-xs">Select series to send for AI analysis</p>
        <SeriesSelector
          series={series}
          selectedSeriesUIDs={selectedSeriesUIDs}
          onToggleSeries={onToggleSeries}
          onSelectAll={onSelectAll}
          onClearSelection={onClearSelection}
        />
        <div className="text-muted-foreground bg-muted rounded p-2 text-xs">
          ℹ️ Only original series shown. AI results excluded.
        </div>
      </div>
    );
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overflow-x-hidden px-3 pt-4 pb-4">
        {renderContent()}
      </div>

      <div className="border-input flex-shrink-0 space-y-2 border-t bg-background px-3 py-3">
        <Button
          onClick={onNext}
          disabled={selectedSeriesUIDs.size === 0 || isLoading}
          className="w-full"
        >
          Next: Confirm &amp; Run &rarr;
        </Button>
        {onBack && (
          <Button
            onClick={onBack}
            variant="outline"
            className="w-full"
          >
            &larr; Back
          </Button>
        )}
      </div>
    </div>
  );
};
