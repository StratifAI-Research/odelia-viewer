import React from 'react';
import { Button } from '@ohif/ui-next';
import type { ModelManifest } from '../../services/OrthancAIService';

interface InputModeSelectionStepProps {
  manifest: ModelManifest;
  selectedConfigId: string | null;
  onSelectConfig: (configId: string) => void;
  onNext: () => void;
  onBack: () => void;
}

export const InputModeSelectionStep: React.FC<InputModeSelectionStepProps> = ({
  manifest,
  selectedConfigId,
  onSelectConfig,
  onNext,
  onBack,
}) => {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden px-3 pt-4 pb-4">
        <div>
          <label className="text-muted-foreground mb-2 block text-xs font-medium">
            Select Input Mode
          </label>
          <div className="space-y-2">
            {manifest.input_configurations.map(config => (
              <label
                key={config.id}
                className={`flex cursor-pointer items-start rounded border p-3 transition-colors ${
                  selectedConfigId === config.id
                    ? 'border-primary-light bg-primary-dark/20'
                    : 'border-secondary-light bg-secondary-dark hover:border-secondary-light/60'
                }`}
              >
                <input
                  type="radio"
                  name="inputConfig"
                  value={config.id}
                  checked={selectedConfigId === config.id}
                  onChange={() => onSelectConfig(config.id)}
                  className="accent-primary-light mt-0.5 mr-3"
                />
                <div>
                  <div className="text-sm text-white">{config.name}</div>
                  {config.description && (
                    <div className="text-muted-foreground mt-1 text-xs">{config.description}</div>
                  )}
                  <div className="text-muted-foreground mt-1 text-xs">
                    {config.inputs.length} input{config.inputs.length !== 1 ? 's' : ''} required
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="border-secondary-light flex-shrink-0 space-y-2 border-t bg-black px-3 py-3">
        <Button
          onClick={onNext}
          disabled={!selectedConfigId}
          className="w-full"
        >
          Next: Map Series &rarr;
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
