import React, { useEffect } from 'react';
import { Button } from '@ohif/ui';
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
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 min-h-0 px-3 pt-4 pb-4 space-y-4 overflow-y-auto overflow-x-hidden">
        <div className="text-sm bg-secondary-dark rounded p-3 space-y-1">
          <div className="text-white font-medium">{selectedConfig.name}</div>
          {selectedConfig.description && (
            <div className="text-xs text-muted-foreground">{selectedConfig.description}</div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="text-xs font-medium text-muted-foreground">
              Map Series to Inputs
            </label>
            <button
              onClick={() => onAutoDetect(selectedConfig, availableSeries)}
              className="text-xs text-primary-light hover:underline"
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
                  <label className="text-xs text-white block mb-1">
                    {input.label}
                    {input.required && <span className="text-red-400 ml-1">*</span>}
                  </label>
                  <select
                    value={currentValue}
                    onChange={e =>
                      onSetInputSeries(input.key, e.target.value || null)
                    }
                    className="w-full px-2 py-1.5 text-xs rounded bg-secondary-dark border border-secondary-light text-white focus:border-primary-light focus:outline-none"
                  >
                    <option value="">-- Select series --</option>
                    {filteredSeries.map(s => (
                      <option key={s.SeriesInstanceUID} value={s.SeriesInstanceUID}>
                        {formatSeriesOption(s)}
                      </option>
                    ))}
                  </select>
                  {input.required && !mapping[input.key] && (
                    <div className="text-xs text-yellow-400 mt-0.5">Required</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="flex-shrink-0 px-3 py-3 border-t border-secondary-light bg-black space-y-2">
        <Button onClick={onNext} disabled={!isValid} className="w-full">
          Next: Confirm &amp; Run &rarr;
        </Button>
        <Button onClick={onBack} variant="outlined" className="w-full">
          &larr; Back
        </Button>
      </div>
    </div>
  );
};
