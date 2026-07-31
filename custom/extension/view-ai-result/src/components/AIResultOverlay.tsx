import React from 'react';
import { useViewportAIState } from '../stores/useAIViewportStore';
import { getAISummaryLines } from '../utils/formatClassification';

/**
 * The AI summary shown in the top-left of a viewport: model name plus the
 * per-side classification.
 *
 * This is a `viewportOverlay.topLeft` item (see `getCustomizationModule`), so
 * it is always visible — unlike the action corners, which OHIF 3.13 only
 * reveals on hover / for the active viewport. Information belongs in the
 * overlay; the heatmap *action* lives in a corner.
 */
export function AIResultOverlay({ viewportId }: { viewportId: string }) {
  const aiState = useViewportAIState(viewportId);
  const aiResult = aiState?.aiResult;

  if (!aiResult) {
    return null;
  }

  const { model, left, right } = getAISummaryLines(aiResult);

  return (
    <div
      className="overlay-item flex flex-col gap-0.5 font-semibold text-blue-300"
      data-cy="ai-result-overlay"
    >
      <div>{`🤖 ${model}`}</div>
      <div>{`Left Breast: ${left}`}</div>
      <div>{`Right Breast: ${right}`}</div>
    </div>
  );
}

export default AIResultOverlay;
