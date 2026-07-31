import React, { useEffect } from 'react';
import {
  Button,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@ohif/ui-next';
import type { InputConfiguration } from '../../services/OrthancAIService';
import type { SeriesInfo } from '../SeriesSelector';

// Radix rejects an empty-string item value (it reserves '' for "no selection"),
// so clearing a mapping needs an explicit sentinel item rather than the
// `<option value="">` a native select would use.
const UNASSIGNED = '__unassigned__';

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
  // Identity, not length: the series list can be replaced by a different list
  // of the same size (display sets still streaming in), which would leave the
  // mapping pointing at UIDs that no longer exist while `isValid` still reports
  // true — i.e. the wizard would send dead series UIDs to the AI.
  const seriesSignature = availableSeries.map(s => s.SeriesInstanceUID).join('|');

  useEffect(() => {
    const availableUIDs = new Set(availableSeries.map(s => s.SeriesInstanceUID));
    const assigned = Object.entries(mapping).filter(
      (entry): entry is [string, string] => entry[1] != null
    );
    const stale = assigned.filter(([, uid]) => !availableUIDs.has(uid));

    // Every assignment still resolves — leave the reader's mapping alone.
    if (stale.length === 0 && assigned.length > 0) {
      return;
    }
    // Nothing usable is mapped (fresh step, or the whole set was replaced):
    // run detection against the series we actually have.
    if (stale.length === assigned.length && availableSeries.length > 0) {
      onAutoDetect(selectedConfig, availableSeries);
      return;
    }
    // Some assignments survived. Keep those — `onAutoDetect` would rewrite the
    // whole mapping and could overwrite a deliberate pick — and drop only the
    // dead ones, so `isValid` stops accepting series that no longer exist.
    stale.forEach(([key]) => onSetInputSeries(key, null));
    // `mapping` is deliberately not a dependency: it is what this effect writes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedConfig.id, seriesSignature]);

  const formatSeriesOption = (s: SeriesInfo) => {
    const desc = s.SeriesDescription || `Series ${s.SeriesNumber}`;
    return `${desc} (${s.Modality}, ${s.numImageFrames} inst.)`;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-3 pt-4 pb-4">
        <div className="bg-muted space-y-1 rounded p-3 text-sm">
          <div className="text-foreground font-medium">{selectedConfig.name}</div>
          {selectedConfig.description && (
            <div className="text-muted-foreground text-xs">{selectedConfig.description}</div>
          )}
        </div>

        <div>
          <div className="mb-2 flex items-center justify-between">
            <label className="text-muted-foreground text-xs font-medium">
              Map Series to Inputs
            </label>
            <Button
              variant="link"
              size="sm"
              onClick={() => onAutoDetect(selectedConfig, availableSeries)}
            >
              Auto-detect
            </Button>
          </div>

          <div className="space-y-3">
            {selectedConfig.inputs.map(input => {
              const filteredSeries = input.modality
                ? availableSeries.filter(s => s.Modality === input.modality)
                : availableSeries;
              const currentValue = mapping[input.key] ?? '';

              return (
                <div key={input.key}>
                  <Label className="mb-1 block text-xs">
                    {input.label}
                    {input.required && <span className="ml-1 text-red-400">*</span>}
                  </Label>
                  <Select
                    // Map "no mapping" onto the sentinel rather than '': with ''
                    // Radix shows the placeholder and marks nothing selected, so
                    // "Not assigned" would never read back as the current choice.
                    value={currentValue || UNASSIGNED}
                    onValueChange={value =>
                      onSetInputSeries(input.key, value === UNASSIGNED ? null : value)
                    }
                  >
                    <SelectTrigger aria-label={input.label}>
                      <SelectValue placeholder="Select series…" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={UNASSIGNED}>Not assigned</SelectItem>
                      {filteredSeries.map(s => (
                        <SelectItem
                          key={s.SeriesInstanceUID}
                          value={s.SeriesInstanceUID}
                        >
                          {formatSeriesOption(s)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {input.required && !mapping[input.key] && (
                    <div className="mt-0.5 text-xs text-yellow-400">Required</div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="border-input bg-background flex-shrink-0 space-y-2 border-t px-3 py-3">
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
