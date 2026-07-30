import { AIResult } from '../types';
import { extractAIResultData } from '../utils/extractAIResultData';
import { resultTsFromDisplaySet } from '../utils/dicomDateTime';
import { findMatchingHeatmap } from '../utils/aiResultPairing';

/**
 * Pure extraction + pairing of AI results from DICOM display sets.
 *
 * This module holds the stateless logic behind `AIResultsService`: given
 * display sets it produces {@link AIResult} objects, with no caching, event
 * bus, selection state, or UI notifications.
 * `AIResultsService` is the stateful shell that owns those concerns and calls
 * into here. Keeping the logic pure makes SR→heatmap pairing and result shaping
 * independently unit-testable.
 */

type AIResultData = ReturnType<typeof extractAIResultData>;

function mapModelInfo(modelInfo: any): AIResult['modelInfo'] {
  if (!modelInfo) {
    return undefined;
  }
  return {
    name: modelInfo.name,
    algorithmName: modelInfo.algorithmName || undefined,
    algorithmVersion: modelInfo.algorithmVersion || undefined,
  };
}

/** True when extracted data carries something worth surfacing as a result. */
export function hasUsableAIResultData(data: AIResultData): boolean {
  return !!data && (data.classifications.length > 0 || !!data.modelInfo);
}

/**
 * Build an {@link AIResult} from an SR display set and its already-extracted
 * data, pairing it against the study's SC (heatmap) display sets.
 */
export function buildAIResult(
  srDisplaySet: any,
  aiResultData: NonNullable<AIResultData>,
  scDisplaySets: any[],
  studyInstanceUID: string
): AIResult {
  const heatmapDisplaySet = findMatchingHeatmap(
    srDisplaySet,
    scDisplaySets,
    aiResultData.modelInfo?.name
  );

  return {
    studyInstanceUID,
    displaySetInstanceUID: srDisplaySet.displaySetInstanceUID,
    hasHeatmap: !!heatmapDisplaySet,
    classifications: aiResultData.classifications,
    resultTs: resultTsFromDisplaySet(srDisplaySet),
    heatmapDisplaySet,
    modelInfo: mapModelInfo(aiResultData.modelInfo),
  };
}

/** Build the placeholder result shown when an SR fails to parse. */
export function buildErrorResult(srDisplaySet: any, studyInstanceUID: string): AIResult {
  return {
    studyInstanceUID,
    displaySetInstanceUID: srDisplaySet.displaySetInstanceUID,
    hasHeatmap: false,
    classifications: [
      {
        side: 'Left',
        result: null,
        confidence: null,
        errorMessage: 'AI results could not be parsed',
      },
      {
        side: 'Right',
        result: null,
        confidence: null,
        errorMessage: 'AI results could not be parsed',
      },
    ],
    resultTs: resultTsFromDisplaySet(srDisplaySet),
    modelInfo: {
      name: 'AI Model (Error)',
      algorithmName: 'Unknown',
      algorithmVersion: 'Unknown',
    },
  };
}

/**
 * Extract every AI result for a study from its display sets. SR display sets
 * that parse become {@link AIResult}s (paired with their heatmap); SRs that
 * throw become error results. Non-SR/SC display sets are ignored.
 */
export function extractAIResultsForStudy(
  studyDisplaySets: any[],
  studyInstanceUID: string
): AIResult[] {
  const srDisplaySets = studyDisplaySets.filter(ds => ds.Modality === 'SR');
  if (srDisplaySets.length === 0) {
    return [];
  }
  const scDisplaySets = studyDisplaySets.filter(ds => ds.Modality === 'SC');

  const results: AIResult[] = [];
  srDisplaySets.forEach(srDisplaySet => {
    try {
      const aiResultData = extractAIResultData(srDisplaySet);
      if (hasUsableAIResultData(aiResultData)) {
        results.push(buildAIResult(srDisplaySet, aiResultData!, scDisplaySets, studyInstanceUID));
      }
    } catch (error) {
      console.warn('Error parsing AI results from SR:', error);
      results.push(buildErrorResult(srDisplaySet, studyInstanceUID));
    }
  });

  return results;
}
