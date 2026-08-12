import React from 'react';
import AIResultOverlay from './components/AIResultOverlay';

/** Identifies our own topLeft item, so re-applying the customization cannot duplicate it. */
const AI_RESULT_SUMMARY_ID = 'aiResultSummary';

type OverlayItem = { id?: string };

const aiResultSummary = {
  id: AI_RESULT_SUMMARY_ID,
  contentF: ({ viewportId }: { viewportId: string }) => <AIResultOverlay viewportId={viewportId} />,
};

/**
 * Customizations a mode can opt into by name, e.g.
 *
 *   customizationService.setCustomizations([
 *     'view-ai-result.customizationModule.aiViewportOverlay',
 *   ]);
 *
 * They are deliberately NOT named `default` / `global`: those two names are
 * applied automatically for every registered extension, which would put the
 * AI overlay into modes that have nothing to do with AI results.
 */
function getCustomizationModule() {
  return [
    {
      name: 'aiViewportOverlay',
      value: {
        // ONLY topLeft is touched, and it is PREPENDED to rather than replaced.
        //
        // This used to set all four corners to fixed arrays -- the AI summary in
        // topLeft, and `[]` for the other three -- so that "the corners stay
        // uncluttered". Two of those were real losses: upstream 3.13 puts the
        // Window/Level readout in `bottomLeft` and the Instance Number in
        // `bottomRight`, and both are things a reader uses on every study.
        // (`topRight` is already `[]` upstream, so that entry was a no-op.)
        //
        // The loss was also wider than it looked. The customization is applied
        // at mode entry, unconditionally, so it blanked the corners for a study
        // that has not been sent to AI yet -- the normal entry state -- and for
        // any plain series dragged into a second viewport. `AIResultOverlay`
        // already renders `null` without a result, so prepending is correct in
        // both states and needs no condition.
        //
        // `$apply` rather than `$unshift`: it composes with whatever upstream
        // declares (including nothing at all, which `$unshift` would throw on),
        // and filtering our own id first keeps it idempotent if the mode ever
        // applies this twice.
        'viewportOverlay.topLeft': {
          $apply: (existing: OverlayItem[] | undefined) => [
            aiResultSummary,
            ...(existing ?? []).filter(item => item?.id !== AI_RESULT_SUMMARY_ID),
          ],
        },
      },
    },
  ];
}

export default getCustomizationModule;
