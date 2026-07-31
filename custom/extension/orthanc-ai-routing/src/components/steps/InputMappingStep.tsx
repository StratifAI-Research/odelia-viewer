import React, { useEffect } from 'react';
import { Button } from '@ohif/ui-next';
import type { InputConfiguration } from '../../services/OrthancAIService';
import type { SeriesInfo } from '../SeriesSelector';

interface InputMappingStepProps {
  selectedConfig: InputConfiguration;
  availableSeries: SeriesInfo[];
  mapping: Record<string, string | null>;
  onSetInputSeries: (key: string, seriesUID: string | null) => void;
  onAutoDetect: (config: InputConfiguration, series: SeriesInfo[]) => void;
  isValid: boolean;
  onNext: () => void;
  onBack: () => void;
}

export const InputMappingStep: React.FC<InputMappingStepProps> = ({
  selectedConfig,
  availableSeries,
  mapping,
  onSetInputSeries,
  onAutoDetect,
  isValid,
  onNext,
  onBack,
}) => {
  useEffect(() => {
    if (availableSeries.length > 0) {
      const hasAnyMapping = Object.values(mapping).some(v => v != null);
      if (!hasAnyMapping) {
        onAutoDetect(selectedConfig, availableSeries);
      }
    }
  }, [selectedConfig.id, availableSeries.length]);

  const formatSeriesOption = (s: SeriesInfo) => {
    const desc = s.SeriesDescription || `Series ${s.SeriesNumber}`;
    return `${desc} (${s.Modality}, ${s.numImageFrames} inst.)`;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-3 pt-4 pb-4">
        <div className="bg-secondary-dark space-y-1 rounded p-3 text-sm">
          <div className="font-medium text-white">{selectedConfig.name}</div>
          {selectedConfig.description && (
            <div className="text-muted-foreground text-xs">{selectedConfig.description}</div>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-muted-foreground text-xs font-medium">
              Map Series to Inputs
            </label>
            <button
              onClick={() => onAutoDetect(selectedConfig, availableSeries)}
              className="text-primary-light text-xs hover:underline"
            >
              Auto-detect
            </button>
          </div>

          <div className="space-y-3">
            {selectedConfig.inputs.map(input => {
              const filteredSeries = input.modality
                ? availableSeries.filter(s => s.Modality === input.modality)
                : availableSeries;
              const currentValue = mapping[input.key] ?? '';

              return (
                <div key={input.key}>
                  <label className="mb-1 block text-xs text-white">
                    {input.label}
                    {input.required && <span className="ml-1 text-red-400">*</span>}
                  </label>
                  <select
                    value={currentValue}
                    onChange={e => onSetInputSeries(input.key, e.target.value || null)}
                    className="bg-secondary-dark border-secondary-light focus:border-primary-light w-full rounded border px-2 py-1.5 text-xs text-white focus:outline-none"
                  >
                    <option value="">-- Select series --</option>
                    {filteredSeries.map(s => (
                      <option
                        key={s.SeriesInstanceUID}
                        value={s.SeriesInstanceUID}
                      >
                        {formatSeriesOption(s)}
                      </option>
                    ))}
                  </select>
                  {input.required && !mapping[input.key] && (
                    <div className="mt-0.5 text-xs text-yellow-400">Required</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="border-secondary-light flex-shrink-0 space-y-2 border-t bg-black px-3 py-3">
        <Button
          onClick={onNext}
          disabled={!isValid}
          className="w-full"
        >
          Next: Confirm &amp; Run &rarr;
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
