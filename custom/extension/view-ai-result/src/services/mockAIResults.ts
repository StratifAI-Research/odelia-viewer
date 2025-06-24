import { MockAIResults, AIResult } from '../types';
import { getAIResults as getAIResultsFromService } from './AIResultsService';

// Keep legacy mock data for reference/testing
const mockAIResults: MockAIResults = {
  'mock-study-1': {
    studyInstanceUID: 'mock-study-1',
    classifications: [
      {
        side: 'Left' as const,
        isMalignant: true,
        confidence: 0.85
      },
      {
        side: 'Right' as const,
        isMalignant: false,
        confidence: 0.92
      }
    ],
    hasHeatmap: true
  },
  'mock-study-2': {
    studyInstanceUID: 'mock-study-2',
    classifications: [
      {
        side: 'Left' as const,
        isMalignant: false,
        confidence: 0.78
      },
      {
        side: 'Right' as const,
        isMalignant: false,
        confidence: 0.95
      }
    ],
    hasHeatmap: false
  }
};

// Main function - now uses real DICOM parsing instead of mock data
export function getAIResults(studyInstanceUID: string, servicesManager: any): AIResult | null {
  // Use the new AI Results Service to get real data from DICOM files
  return getAIResultsFromService(studyInstanceUID, servicesManager);
}
