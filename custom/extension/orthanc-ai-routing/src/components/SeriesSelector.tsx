import React from 'react';
import { Button } from '@ohif/ui';

export interface SeriesInfo {
  displaySetInstanceUID: string;
  SeriesInstanceUID: string;
  SeriesDescription: string;
  SeriesNumber: number;
  Modality: string;
  numImageFrames: number;
  StudyInstanceUID: string;
}

interface SeriesSelectorProps {
  series: SeriesInfo[];
  selectedSeriesUIDs: Set<string>;
  onToggleSeries: (seriesUID: string) => void;
  onSelectAll: () => void;
  onClearSelection: () => void;
}

const SeriesSelector: React.FC<SeriesSelectorProps> = ({
  series,
  selectedSeriesUIDs,
  onToggleSeries,
  onSelectAll,
  onClearSelection,
}) => {
  if (series.length === 0) {
    return (
      <div className="text-muted-foreground bg-secondary-dark rounded p-3 text-sm">
        No series available for this study
      </div>
    );
  }

  const totalInstances = series
    .filter(s => selectedSeriesUIDs.has(s.SeriesInstanceUID))
    .reduce((sum, s) => sum + (s.numImageFrames || 0), 0);

  return (
    <div className="space-y-2">
      {/* Series list - can be larger now since button is fixed at bottom */}
      <div className="max-h-64 space-y-2 overflow-y-auto pr-1">
        {series.map(seriesItem => {
          const isSelected = selectedSeriesUIDs.has(seriesItem.SeriesInstanceUID);

          return (
            <div
              key={seriesItem.SeriesInstanceUID}
              onClick={() => onToggleSeries(seriesItem.SeriesInstanceUID)}
              className={`border-secondary-light cursor-pointer rounded border p-2 transition-colors ${
                isSelected
                  ? 'bg-primary-dark border-primary-light'
                  : 'hover:bg-secondary-dark bg-black'
              } `}
            >
              <div className="flex items-start gap-3">
                {/* Checkbox */}
                <div className="mt-1 flex-shrink-0">
                  <div
                    className={`flex h-4 w-4 items-center justify-center rounded border-2 ${
                      isSelected
                        ? 'border-primary-light bg-primary-light'
                        : 'border-secondary-light'
                    } `}
                  >
                    {isSelected && (
                      <svg
                        className="h-3 w-3 text-black"
                        fill="none"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="2"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                      >
                        <path d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </div>
                </div>

                {/* Series info */}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-white">
                    {seriesItem.SeriesDescription || `Series ${seriesItem.SeriesNumber || 'N/A'}`}
                  </div>
                  <div className="text-muted-foreground mt-1 text-xs">
                    {seriesItem.Modality} · {seriesItem.numImageFrames || 0} instances
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onSelectAll();
          }}
          className="flex-1"
          variant="outlined"
          size="small"
        >
          ✓ Select All
        </Button>
        <Button
          onClick={(e: React.MouseEvent) => {
            e.stopPropagation();
            onClearSelection();
          }}
          className="flex-1"
          variant="outlined"
          size="small"
        >
          Clear
        </Button>
      </div>

      {/* Selection summary - compact */}
      <div className="text-muted-foreground bg-secondary-dark rounded px-2 py-1 text-xs">
        {selectedSeriesUIDs.size} series ({totalInstances} instances)
      </div>
    </div>
  );
};

export default SeriesSelector;
