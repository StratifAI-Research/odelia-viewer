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
    isClassification: false,
  };

  // Find the root container or use the entire content sequence
  const rootContainer = contentSequence.find(item => item.ValueType === 'CONTAINER');
  const itemsToProcess = rootContainer?.ContentSequence || contentSequence;

  // Extract classification results and model info from content items
  itemsToProcess.forEach(item => {
    const conceptMeaning = item.ConceptNameCodeSequence?.[0]?.CodeMeaning;

    if (!conceptMeaning) {
      return;
    }

    // Handle successful classification results (Side Probability)
    if (conceptMeaning.includes('Side Probability')) {
      const side = conceptMeaning.includes('Left') ? 'Left' : 'Right';
      const codeMeaning = item.ConceptCodeSequence?.[0]?.CodeMeaning;
      const rawConfidence = item.MeasuredValueSequence?.[0]?.NumericValue;
      // Preserve a real 0 (0.0% probability): only null/undefined/'' map to null,
      // and a non-numeric value normalizes to null rather than NaN.
      let confidence: number | null = null;
      if (rawConfidence != null && rawConfidence !== '') {
        const parsed = parseFloat(rawConfidence);
        confidence = Number.isNaN(parsed) ? null : parsed;
      }

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
          confidence,
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
        errorMessage: errorMessage,
      };

      results.classifications.push(classification);
    }

    // Handle model information
    else if (conceptMeaning === 'AI Model') {
      results.modelInfo = {
        name: item.TextValue || 'AI Model',
        algorithmName: item.AlgorithmName || null,
        algorithmVersion: item.AlgorithmVersion || null,
      };
    }
  });

  return results.classifications.length > 0 || results.modelInfo ? results : null;
}
