import type { AIResult, Classification } from '../types';

/**
 * One line of the viewport's AI summary, e.g. `Malignant (88.7%)`.
 *
 * An error reported by the model wins over its (absent) score; a side the
 * model said nothing about renders as `--` rather than being dropped, so the
 * overlay always shows both breasts and a missing side is visibly missing.
 */
export function formatClassification(classification?: Classification): string {
  if (!classification) {
    return '--';
  }

  if (classification.errorMessage) {
    return classification.errorMessage;
  }

  const { result, confidence } = classification;
  const score = confidence != null ? `${confidence.toFixed(1)}%` : '--%';
  return `${result || 'Unknown'} (${score})`;
}

/** The lines the AI overlay renders, in display order. */
export function getAISummaryLines(aiResult: AIResult): {
  model: string;
  left: string;
  right: string;
} {
  const classifications = aiResult.classifications ?? [];

  return {
    model: aiResult.modelInfo?.name || 'AI Model',
    left: formatClassification(classifications.find(c => c.side === 'Left')),
    right: formatClassification(classifications.find(c => c.side === 'Right')),
  };
}
