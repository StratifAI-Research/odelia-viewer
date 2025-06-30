import React from 'react';
import { AIClassificationOverlayProps } from '../../types/overlayTypes';

const AIClassificationOverlay: React.FC<AIClassificationOverlayProps> = ({ aiResult }) => {
  if (!aiResult?.classifications) return null;

  const leftBreast = aiResult.classifications.find(c => c.side === 'Left');
  const rightBreast = aiResult.classifications.find(c => c.side === 'Right');

  const renderClassification = (breast: any, side: string) => (
    <div className="flex flex-row items-center mt-1">
      <span className="mr-1 shrink-0">{side} Breast:</span>
      {breast ? (
        <>
          <span className={`ml-1 shrink-0 ${breast.isMalignant ? 'text-red-400' : 'text-green-400'}`}>
            {breast.isMalignant ? 'Malignant' : 'Benign'}
          </span>
          <span className="ml-2 shrink-0">
            ({breast.confidence ? (breast.confidence * 100).toFixed(1) : 'N/A'}%)
          </span>
        </>
      ) : (
        <span className="ml-1 shrink-0 text-gray-400">No data</span>
      )}
    </div>
  );

  return (
    <div className="overlay-item flex flex-col max-w-xs">
      <div className="flex flex-col mb-2 pb-1 border-b border-gray-500">
        <div className="flex flex-row items-center">
          <span className="text-sm font-semibold text-blue-300">
            🤖 {aiResult.modelInfo?.name || 'AI Model'}
          </span>
        </div>
      </div>
      <div className="flex flex-col space-y-1">
        {renderClassification(leftBreast, 'Left')}
        {renderClassification(rightBreast, 'Right')}
      </div>
    </div>
  );
};

export default AIClassificationOverlay;
