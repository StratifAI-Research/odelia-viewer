import React from 'react';
import { Button } from '@ohif/ui';
import SeriesSelector, { SeriesInfo } from '../SeriesSelector';
import { SeriesListSkeleton, EmptyState, ErrorState } from '../LoadingStates';

interface SeriesSelectionStepProps {
  studyDescription: string;
  series: SeriesInfo[];
  selectedSeriesUIDs: Set<string>;
  onToggleSeries: (seriesUID: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
  onNext: () => void;
  onBack: () => void;
  isLoading?: boolean;
  error?: string | null;
}

export const SeriesSelectionStep: React.FC<SeriesSelectionStepProps> = ({
  studyDescription,
  series,
  selectedSeriesUIDs,
  onToggleSeries,
  onSelectAll,
  onClearSelection,
  onNext,
  onBack,
  isLoading,
  error,
}) => {
  const renderContent = () => {
    if (error) {
      return (
        <ErrorState
          title="Failed to Load Series"
          message={error}
        />
      );
    }

    if (isLoading) {
      return (
        <div>
          <h4 className="text-sm font-medium mb-1 text-white">
            {studyDescription}
          </h4>
          <p className="text-xs text-muted-foreground mb-3">
            Loading series...
          </p>
          <SeriesListSkeleton />
        </div>
      );
    }

    if (series.length === 0) {
      return (
        <div>
          <h4 className="text-sm font-medium mb-1 text-white">
            {studyDescription}
          </h4>
          <EmptyState
            icon="🔍"
            title="No Series Available"
            message="This study contains only AI results. No original series available to send."
          />
        </div>
      );
    }

    return (
      <>
        <div>
          <h4 className="text-sm font-medium mb-1 text-white">
            {studyDescription}
          </h4>
          <p className="text-xs text-muted-foreground mb-3">
            Select series to send for AI analysis
          </p>
          <SeriesSelector
            series={series}
            selectedSeriesUIDs={selectedSeriesUIDs}
            onToggleSeries={onToggleSeries}
            onSelectAll={onSelectAll}
            onClearSelection={onClearSelection}
          />
        </div>

        <div className="text-xs text-muted-foreground p-2 bg-secondary-dark rounded">
          ℹ️ Only original series are shown. AI results (SR/SC) are excluded.
        </div>
      </>
    );
  };

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 p-4 space-y-4 overflow-y-auto">
        {renderContent()}
      </div>

      <div className="p-4 border-t border-secondary-light space-y-2">
        <Button
          onClick={onNext}
          disabled={selectedSeriesUIDs.size === 0 || isLoading}
          className="w-full"
        >
          Next: Select AI Model →
        </Button>
        <Button
          onClick={onBack}
          variant="outlined"
          className="w-full"
          disabled={isLoading}
        >
          ← Back to Studies
        </Button>
      </div>
    </div>
  );
};
