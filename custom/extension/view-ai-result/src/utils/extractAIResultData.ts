/**
 * Extracts AI classification results and model information from DICOM SR ContentSequence
 * @param {object} displaySet - The display set containing the DICOM SR data
 * @returns {object} - Object containing classification results and model info
 */
export function extractAIResultData(displaySet) {
  if (!displaySet || displaySet.Modality !== 'SR' || !displaySet.instance?.ContentSequence) {
    return null;
  }

  // Debug: Log the entire displaySet structure for AI results
  console.log('Extracting AI data from SR:', {
    SeriesDescription: displaySet.SeriesDescription,
    Modality: displaySet.Modality,
    instance: displaySet.instance
  });

  const contentSequence = displaySet.instance.ContentSequence;
  const results: {
    classifications: Array<{
      concept: string;
      result: string;
      confidence: number | null;
    }>;
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
        // Classification results (findings with confidence values)
    if (item.ValueType === 'CODE' &&
        (item.ConceptNameCodeSequence?.[0]?.CodeMeaning?.toLowerCase().includes('probability') ||
         item.ConceptNameCodeSequence?.[0]?.CodeMeaning?.toLowerCase().includes('side') ||
         item.ConceptNameCodeSequence?.[0]?.CodeMeaning?.toLowerCase().includes('finding') ||
         item.ConceptNameCodeSequence?.[0]?.CodeMeaning?.toLowerCase().includes('diagnosis') ||
         item.ConceptCodeSequence?.[0]?.CodeMeaning?.toLowerCase().includes('benign') ||
         item.ConceptCodeSequence?.[0]?.CodeMeaning?.toLowerCase().includes('malignant'))) {

      const classification: {
        concept: string;
        result: string;
        confidence: number | null;
      } = {
        concept: item.ConceptNameCodeSequence?.[0]?.CodeMeaning || 'Classification',
        result: item.ConceptCodeSequence?.[0]?.CodeMeaning || 'Unknown',
        confidence: null
      };

      // Extract confidence value if available
      if (item.MeasuredValueSequence?.[0]?.NumericValue) {
        const numericValue = parseFloat(item.MeasuredValueSequence[0].NumericValue);
        classification.confidence = isNaN(numericValue) ? null : numericValue;
      }

      results.classifications.push(classification);
      results.isClassification = true;
    }

            // Model information - look for various patterns
    if ((item.ValueType === 'CODE' &&
         (item.ConceptNameCodeSequence?.[0]?.CodeMeaning?.toLowerCase().includes('model') ||
          item.ConceptNameCodeSequence?.[0]?.CodeMeaning?.toLowerCase().includes('algorithm') ||
          item.ConceptNameCodeSequence?.[0]?.CodeMeaning?.toLowerCase().includes('software') ||
          item.ConceptNameCodeSequence?.[0]?.CodeMeaning?.toLowerCase().includes('device'))) ||
        (item.ValueType === 'TEXT' &&
         (item.ConceptNameCodeSequence?.[0]?.CodeMeaning?.toLowerCase().includes('model') ||
          item.ConceptNameCodeSequence?.[0]?.CodeMeaning?.toLowerCase().includes('algorithm')))) {

      results.modelInfo = {
        name: item.ConceptCodeSequence?.[0]?.CodeMeaning ||
              item.TextValue ||
              item.ConceptNameCodeSequence?.[0]?.CodeMeaning ||
              'AI Model',
        algorithmName: item.AlgorithmName || item.ConceptNameCodeSequence?.[0]?.CodeMeaning || null,
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
export function formatClassificationPreview(classifications) {
  if (!classifications || classifications.length === 0) {
    return '';
  }

  return classifications.map(classification => {
    const result = classification.result;
    const confidence = classification.confidence !== null ?
      ` (${classification.confidence.toFixed(1)}%)` : '';
    return `${result}${confidence}`;
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
