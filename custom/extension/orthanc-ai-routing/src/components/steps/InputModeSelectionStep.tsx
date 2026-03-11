import React from 'react';
import { Button } from '@ohif/ui';
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
    <div className="flex-1 flex flex-col min-h-0">
      <div className="flex-1 min-h-0 px-3 pt-4 pb-4 space-y-4 overflow-y-auto overflow-x-hidden">
        <div>
          <label className="text-xs font-medium text-muted-foreground block mb-2">
            Select Input Mode
          </label>
          <div className="space-y-2">
            {manifest.input_configurations.map(config => (
              <label
                key={config.id}
                className={`flex items-start p-3 rounded cursor-pointer border transition-colors ${
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
                  className="mt-0.5 mr-3 accent-primary-light"
                />
                <div>
                  <div className="text-sm text-white">{config.name}</div>
                  {config.description && (
                    <div className="text-xs text-muted-foreground mt-1">{config.description}</div>
                  )}
                  <div className="text-xs text-muted-foreground mt-1">
                    {config.inputs.length} input{config.inputs.length !== 1 ? 's' : ''} required
                  </div>
                </div>
              </label>
            ))}
          </div>
        </div>
      </div>

      <div className="flex-shrink-0 px-3 py-3 border-t border-secondary-light bg-black space-y-2">
        <Button onClick={onNext} disabled={!selectedConfigId} className="w-full">
          Next: Map Series &rarr;
        </Button>
        <Button onClick={onBack} variant="outlined" className="w-full">
          &larr; Back
        </Button>
      </div>
    </div>
  );
};
