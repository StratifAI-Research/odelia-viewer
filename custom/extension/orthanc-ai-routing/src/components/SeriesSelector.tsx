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
      <div className="text-sm text-muted-foreground p-3 bg-secondary-dark rounded">
        No series available for this study
      </div>
    );
  }

  const totalInstances = series
    .filter(s => selectedSeriesUIDs.has(s.SeriesInstanceUID))
    .reduce((sum, s) => sum + (s.numImageFrames || 0), 0);

  return (
    <div className="space-y-3">
      {/* Series list */}
      <div className="space-y-2 max-h-64 overflow-y-auto">
        {series.map(seriesItem => {
          const isSelected = selectedSeriesUIDs.has(seriesItem.SeriesInstanceUID);

          return (
            <div
              key={seriesItem.SeriesInstanceUID}
              onClick={() => onToggleSeries(seriesItem.SeriesInstanceUID)}
              className={`
                p-3 rounded cursor-pointer transition-colors
                border border-secondary-light
                ${isSelected
                  ? 'bg-primary-dark border-primary-light'
                  : 'bg-black hover:bg-secondary-dark'
                }
              `}
            >
              <div className="flex items-start gap-3">
                {/* Checkbox */}
                <div className="mt-1 flex-shrink-0">
                  <div
                    className={`
                      w-4 h-4 rounded border-2
                      flex items-center justify-center
                      ${isSelected
                        ? 'border-primary-light bg-primary-light'
                        : 'border-secondary-light'
                      }
                    `}
                  >
                    {isSelected && (
                      <svg
                        className="w-3 h-3 text-black"
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
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white">
                    {seriesItem.SeriesDescription || `Series ${seriesItem.SeriesNumber || 'N/A'}`}
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
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
          onClick={(e) => {
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
          onClick={(e) => {
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

      {/* Selection summary */}
      <div className="text-xs text-muted-foreground p-2 bg-secondary-dark rounded">
        Selected: {selectedSeriesUIDs.size} series ({totalInstances} instances)
      </div>
    </div>
  );
};

export default SeriesSelector;
