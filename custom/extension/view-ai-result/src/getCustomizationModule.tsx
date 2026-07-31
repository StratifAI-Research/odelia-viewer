import React from 'react';
import AIResultOverlay from './components/AIResultOverlay';

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
        // The AI summary replaces the stock patient/series text: this viewport
        // exists to show one model's opinion of one study, and the corners
        // stay uncluttered.
        'viewportOverlay.topLeft': [
          {
            id: 'aiResultSummary',
            contentF: ({ viewportId }: { viewportId: string }) => (
              <AIResultOverlay viewportId={viewportId} />
            ),
          },
        ],
        'viewportOverlay.topRight': [],
        'viewportOverlay.bottomLeft': [],
        'viewportOverlay.bottomRight': [],
      },
    },
  ];
}

export default getCustomizationModule;
