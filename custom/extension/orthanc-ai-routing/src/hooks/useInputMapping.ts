import { useState, useCallback, useMemo } from 'react';
import type { InputConfiguration, InputMapping, ModelManifest } from '../services/OrthancAIService';
import type { SeriesInfo } from '../components/SeriesSelector';

interface UseInputMappingReturn {
  selectedConfigId: string | null;
  mapping: Record<string, string | null>;
  setSelectedConfigId: (configId: string) => void;
  setInputSeries: (key: string, seriesUID: string | null) => void;
  autoDetect: (config: InputConfiguration, availableSeries: SeriesInfo[]) => void;
  isValid: boolean;
  getInputMapping: () => InputMapping;
  getSelectedSeriesUIDs: () => string[];
  reset: () => void;
}

function tryAutoDetectSeries(
  patterns: string[],
  availableSeries: SeriesInfo[],
  modalityFilter?: string
): string | null {
  const candidates = modalityFilter
    ? availableSeries.filter(s => s.Modality === modalityFilter)
    : availableSeries;

  for (const pattern of patterns) {
    try {
      const regex = new RegExp(pattern);
      const match = candidates.find(s => regex.test(s.SeriesDescription || ''));
      if (match) {
        return match.SeriesInstanceUID;
      }
    } catch {
      // skip invalid regex patterns
    }
  }
  return null;
}

export function useInputMapping(manifest: ModelManifest | null): UseInputMappingReturn {
  const [selectedConfigId, setSelectedConfigIdState] = useState<string | null>(
    manifest?.input_configurations?.[0]?.id ?? null
  );
  const [mapping, setMapping] = useState<Record<string, string | null>>({});

  const selectedConfig = useMemo(() => {
    if (!manifest || !selectedConfigId) {
      return null;
    }
    return manifest.input_configurations.find(c => c.id === selectedConfigId) ?? null;
  }, [manifest, selectedConfigId]);

  const setSelectedConfigId = useCallback((configId: string) => {
    setSelectedConfigIdState(configId);
    setMapping({});
  }, []);

  const setInputSeries = useCallback((key: string, seriesUID: string | null) => {
    setMapping(prev => ({ ...prev, [key]: seriesUID }));
  }, []);

  const autoDetect = useCallback((config: InputConfiguration, availableSeries: SeriesInfo[]) => {
    const newMapping: Record<string, string | null> = {};
    const usedUIDs = new Set<string>();

    for (const input of config.inputs) {
      const patterns = input.auto_detect_patterns ?? [];
      const remaining = availableSeries.filter(s => !usedUIDs.has(s.SeriesInstanceUID));
      const detected = tryAutoDetectSeries(patterns, remaining, input.modality);
      newMapping[input.key] = detected;
      if (detected) {
        usedUIDs.add(detected);
      }
    }
    setMapping(newMapping);
  }, []);

  const isValid = useMemo(() => {
    if (!selectedConfig) {
      return false;
    }
    return selectedConfig.inputs
      .filter(input => input.required)
      .every(input => mapping[input.key] != null);
  }, [selectedConfig, mapping]);

  const getInputMapping = useCallback((): InputMapping => {
    const result: InputMapping = {};
    for (const [key, uid] of Object.entries(mapping)) {
      if (uid != null) {
        result[key] = uid;
      }
    }
    return result;
  }, [mapping]);

  const getSelectedSeriesUIDs = useCallback((): string[] => {
    return Object.values(mapping).filter((uid): uid is string => uid != null);
  }, [mapping]);

  const reset = useCallback(() => {
    setSelectedConfigIdState(manifest?.input_configurations?.[0]?.id ?? null);
    setMapping({});
  }, [manifest]);

  return {
    selectedConfigId,
    mapping,
    setSelectedConfigId,
    setInputSeries,
    autoDetect,
    isValid,
    getInputMapping,
    getSelectedSeriesUIDs,
    reset,
  };
}
