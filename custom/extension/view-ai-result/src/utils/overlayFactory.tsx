import React from 'react';
import { OverlayCustomization } from '../types/overlayTypes';
import { AIResult } from '../types';
import AIClassificationOverlay from '../components/overlays/AIClassificationOverlay';

/**
 * Factory to create AI classification overlay customization
 */
export const createAIClassificationOverlay = (aiResult: AIResult): OverlayCustomization => ({
  id: 'AIClassification',
  inheritsFrom: 'ohif.overlayItem',
  title: 'AI Classification',
  color: '#9ccef9',
  contentF: () => <AIClassificationOverlay aiResult={aiResult} />
});

/**
 * Factory to create default "Select AI Result" overlay when no AI result is selected
 */
export const createDefaultAIOverlay = (): OverlayCustomization => ({
  id: 'DefaultAIOverlay',
  inheritsFrom: 'ohif.overlayItem',
  title: 'AI Analysis',
  color: '#9ccef9',
  contentF: () => (
    <div className="overlay-item flex flex-col">
      <div className="flex flex-col mb-2 pb-1 border-b border-gray-500">
        <div className="flex flex-row items-center">
          <span className="text-sm font-semibold text-blue-300">🤖 Select AI Result</span>
        </div>
        <div className="flex flex-row items-center mt-1">
          <span className="text-xs text-gray-300">
            Click an AI thumbnail to view results
          </span>
        </div>
      </div>
    </div>
  )
});

/**
 * Applies overlay customization to OHIF's customization service
 */
export const applyOverlayCustomization = (
  customizationService: any,
  overlay: OverlayCustomization | null
) => {
  const overlayConfig = overlay
    ? { 'viewportOverlay.topLeft': { $set: [overlay] } }
    : { 'viewportOverlay.topLeft': { $set: [] } };

  customizationService.setCustomizations(overlayConfig);
};
