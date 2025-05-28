import { MockAIResults, AIResult } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { servicesManager } from '@ohif/core';

// Mock data for testing
const mockAIResults: MockAIResults = {
  'mock-study-1': {
    classifications: [
      {
        side: 'left' as const,
        isMalignant: true,
        confidence: 0.85
      },
      {
        side: 'right' as const,
        isMalignant: false,
        confidence: 0.92
      }
    ],
    hasHeatmap: true,
    heatmapSeriesInstanceUID: 'mock-heatmap-series-1'
  },
  'mock-study-2': {
    classifications: [
      {
        side: 'left' as const,
        isMalignant: false,
        confidence: 0.78
      },
      {
        side: 'right' as const,
        isMalignant: false,
        confidence: 0.95
      }
    ],
    hasHeatmap: false
  }
};

// Mock AI results using original study's display set
export function getAIResults(studyInstanceUID: string, servicesManager: any): AIResult {
  const { displaySetService } = servicesManager.services;

  // Get all active display sets and filter by study
  const displaySets = displaySetService.getActiveDisplaySets();
  const studyDisplaySets = displaySets.filter(ds => ds.StudyInstanceUID === studyInstanceUID);
  const originalDisplaySet = studyDisplaySets[0];

  return {
    hasHeatmap: true,
    heatmapDisplaySet: originalDisplaySet,
    heatmapSeriesInstanceUID: originalDisplaySet.SeriesInstanceUID,
    classifications: [
      {
        side: 'Left',
        isMalignant: false,
        confidence: 0.95,
      },
      {
        side: 'Right',
        isMalignant: false,
        confidence: 0.98,
      }
    ]
  };
}
