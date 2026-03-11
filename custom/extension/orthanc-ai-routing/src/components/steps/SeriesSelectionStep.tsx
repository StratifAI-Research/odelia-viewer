import React from 'react';
import { Button } from '@ohif/ui';
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
          <p className="text-xs text-muted-foreground">
            Loading series from display sets...
          </p>
          <div className="p-2 bg-secondary-dark rounded text-xs text-muted-foreground">
            <div className="flex items-center space-x-2">
              <div className="animate-spin h-4 w-4 border-2 border-primary-light border-t-transparent rounded-full"></div>
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
        <p className="text-xs text-muted-foreground">
          Select series to send for AI analysis
        </p>
        <SeriesSelector
          series={series}
          selectedSeriesUIDs={selectedSeriesUIDs}
          onToggleSeries={onToggleSeries}
          onSelectAll={onSelectAll}
          onClearSelection={onClearSelection}
        />
        <div className="text-xs text-muted-foreground p-2 bg-secondary-dark rounded">
          ℹ️ Only original series shown. AI results excluded.
        </div>
      </div>
    );
  };

  return (
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 min-h-0 px-3 pt-4 pb-4 space-y-3 overflow-y-auto overflow-x-hidden">
        {renderContent()}
      </div>

      <div className="flex-shrink-0 px-3 py-3 border-t border-secondary-light bg-black space-y-2">
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
            variant="outlined"
            className="w-full"
          >
            &larr; Back
          </Button>
        )}
      </div>
    </div>
  );
};
