import React from 'react';

interface AIResultInfoProps {
  classifications?: Array<{
    concept: string;
    result: string;
    confidence: number | null;
  }>;
  modelInfo?: {
    name: string;
    algorithmName?: string | null;
    algorithmVersion?: string | null;
  } | null;
  isClassification: boolean;
}

/**
 * Component to display AI result information including classification previews and model names
 */
export default function AIResultInfo({ classifications, modelInfo, isClassification }: AIResultInfoProps) {
  const formatClassificationPreview = (classifications: Array<{concept: string; result: string; confidence: number | null}>) => {
    if (!classifications || classifications.length === 0) {
      return '';
    }

    return classifications.map(classification => {
      const result = classification.result;
      const confidence = classification.confidence !== null ?
        ` (${classification.confidence.toFixed(1)}%)` : '';
      return `${result}${confidence}`;
    }).join(', ');
  };

  const getModelDisplayName = (modelInfo: AIResultInfoProps['modelInfo']) => {
    if (!modelInfo) {
      return 'AI Model';
    }

    if (modelInfo.algorithmName && modelInfo.algorithmVersion) {
      return `${modelInfo.algorithmName} v${modelInfo.algorithmVersion}`;
    }

    if (modelInfo.algorithmName) {
      return modelInfo.algorithmName;
    }

    return modelInfo.name || 'AI Model';
  };

    return (
    <div className="mt-1 space-y-1 text-[10px]">
      {/* Model name - always shown for AI results */}
      <div className="flex items-center gap-1 text-blue-300">
        <span className="text-[8px]">🤖</span>
        <span className="truncate font-medium">{getModelDisplayName(modelInfo)}</span>
      </div>

      {/* Classification preview - only shown for classification results */}
      {isClassification && classifications && classifications.length > 0 && (
        <div className="rounded border-l-2 border-blue-400 bg-blue-950/30 p-1">
          <div className="text-blue-300 text-[8px] font-semibold uppercase tracking-wide">
            Result
          </div>
          <div className="text-white mt-0.5 text-[9px] leading-tight">
            {formatClassificationPreview(classifications)}
          </div>
        </div>
      )}
    </div>
  );
}
