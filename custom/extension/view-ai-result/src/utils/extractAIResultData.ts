import { Classification } from '../types';

/**
 * Extracts AI classification results and model information from DICOM SR ContentSequence
 * @param {object} displaySet - The display set containing the DICOM SR data
 * @returns {object} - Object containing classification results and model info
 */
export function extractAIResultData(displaySet) {
  // Process both SR and SC modalities for AI model info extraction
  if (!displaySet || !displaySet.instance?.ContentSequence) {
    return null;
  }

  const modality = displaySet.Modality;
  if (modality !== 'SR' && modality !== 'SC') {
    return null;
  }

  const contentSequence = displaySet.instance.ContentSequence;
  const results: {
    classifications: Classification[];
    modelInfo: {
      name: string;
      algorithmName?: string | null;
      algorithmVersion?: string | null;
    } | null;
    isClassification: boolean;
  } = {
    classifications: [],
    modelInfo: null,
    isClassification: false
  };

  // Find the root container or use the entire content sequence
  const rootContainer = contentSequence.find(item => item.ValueType === 'CONTAINER');
  const itemsToProcess = rootContainer?.ContentSequence || contentSequence;

  // Extract classification results and model info from content items
  itemsToProcess.forEach(item => {
    const conceptMeaning = item.ConceptNameCodeSequence?.[0]?.CodeMeaning;

    if (!conceptMeaning) return;

    // Handle successful classification results (Side Probability)
    if (conceptMeaning.includes('Side Probability')) {
      const side = conceptMeaning.includes('Left') ? 'Left' : 'Right';
      const codeMeaning = item.ConceptCodeSequence?.[0]?.CodeMeaning;
      const confidence = item.MeasuredValueSequence?.[0]?.NumericValue;

      if (codeMeaning) {
        // Map SNOMED CT code meanings to result values
        let result: 'Malignant' | 'Benign' | 'No lesion' | null = null;
        if (codeMeaning === 'Malignant') {
          result = 'Malignant';
        } else if (codeMeaning === 'Benign') {
          result = 'Benign';
        } else if (codeMeaning === 'Clinical finding absent') {
          result = 'No lesion';
        }

        const classification: Classification = {
          side: side as 'Left' | 'Right',
          result: result,
          confidence: confidence ? parseFloat(confidence) : null
        };

        results.classifications.push(classification);
        results.isClassification = true;
      }
    }

    // Handle error cases (Side Analysis)
    else if (conceptMeaning.includes('Side Analysis')) {
      const side = conceptMeaning.includes('Left') ? 'Left' : 'Right';
      const errorMessage = item.TextValue || 'Analysis failed';

      const classification: Classification = {
        side: side as 'Left' | 'Right',
        result: null,
        confidence: null,
        errorMessage: errorMessage
      };

      results.classifications.push(classification);
    }

    // Handle model information
    else if (conceptMeaning === 'AI Model') {
      results.modelInfo = {
        name: item.TextValue || 'AI Model',
        algorithmName: item.AlgorithmName || null,
        algorithmVersion: item.AlgorithmVersion || null
      };
    }
  });

  return results.classifications.length > 0 || results.modelInfo ? results : null;
}

/**
 * Formats classification results for display
 * @param {array} classifications - Array of classification results
 * @returns {string} - Formatted string for display
 */
export function formatClassificationPreview(classifications: Classification[]) {
  if (!classifications || classifications.length === 0) {
    return '';
  }

  return classifications.map(classification => {
    if (classification.errorMessage) {
      return `${classification.side}: Error`;
    }

    const result = classification.result || 'Unknown';
    const confidence = classification.confidence !== null ?
      ` (${classification.confidence.toFixed(1)}%)` : '';
    return `${classification.side}: ${result}${confidence}`;
  }).join(', ');
}

/**
 * Gets the model name for display
 * @param {object} modelInfo - Model information object
 * @returns {string} - Model name for display
 */
export function getModelDisplayName(modelInfo) {
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
}
