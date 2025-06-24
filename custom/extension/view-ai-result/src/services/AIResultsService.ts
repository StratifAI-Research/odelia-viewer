import { AIResult, Classification } from '../types';
import { extractAIResultData } from '../utils/extractAIResultData';

/**
 * Service for extracting AI results from DICOM files
 */
export class AIResultsService {
  private cache: Map<string, AIResult[]> = new Map();
  private selectedAIResults: Map<string, string> = new Map(); // studyUID -> displaySetUID
  private uiNotificationService: any;

  constructor(uiNotificationService: any) {
    this.uiNotificationService = uiNotificationService;
  }

  /**
   * Get all AI results for a study, with caching
   */
  getAllAIResults(studyInstanceUID: string, servicesManager: any): AIResult[] {
    // Check cache first
    if (this.cache.has(studyInstanceUID)) {
      return this.cache.get(studyInstanceUID)!;
    }

    const results = this.extractAIResultsFromStudy(studyInstanceUID, servicesManager);
    this.cache.set(studyInstanceUID, results);
    return results;
  }

  /**
   * Extract AI results from all SR display sets in a study
   */
  private extractAIResultsFromStudy(studyInstanceUID: string, servicesManager: any): AIResult[] {
    const { displaySetService } = servicesManager.services;

    try {
      // Get all display sets for the study
      const allDisplaySets = displaySetService.getActiveDisplaySets();
      const studyDisplaySets = allDisplaySets.filter(ds => ds.StudyInstanceUID === studyInstanceUID);

      // Find all SR display sets (AI results)
      const srDisplaySets = studyDisplaySets.filter(ds => ds.Modality === 'SR');

      if (srDisplaySets.length === 0) {
        return [];
      }

      // Find all SC display sets (potential heatmaps)
      const scDisplaySets = studyDisplaySets.filter(ds => ds.Modality === 'SC');

      const aiResults: AIResult[] = [];

      // Process each SR display set
      srDisplaySets.forEach(srDisplaySet => {
        try {
          const aiResultData = extractAIResultData(srDisplaySet);

          if (aiResultData && (aiResultData.classifications.length > 0 || aiResultData.modelInfo)) {
            // Find matching heatmap
            const heatmapDisplaySet = this.findMatchingHeatmap(
              srDisplaySet,
              scDisplaySets,
              aiResultData.modelInfo?.name
            );

            const aiResult: AIResult = {
              studyInstanceUID,
              hasHeatmap: !!heatmapDisplaySet,
              classifications: aiResultData.classifications,
              heatmapDisplaySet: heatmapDisplaySet,
              modelInfo: aiResultData.modelInfo ? {
                name: aiResultData.modelInfo.name,
                algorithmName: aiResultData.modelInfo.algorithmName || undefined,
                algorithmVersion: aiResultData.modelInfo.algorithmVersion || undefined
              } : undefined
            };

            aiResults.push(aiResult);
          }
        } catch (error) {
          console.warn('Error parsing AI results from SR:', error);

          // Create error result
          const errorResult: AIResult = {
            studyInstanceUID,
            hasHeatmap: false,
            classifications: [
              {
                side: 'Left',
                isMalignant: null,
                confidence: null,
                errorMessage: 'AI results could not be parsed'
              },
              {
                side: 'Right',
                isMalignant: null,
                confidence: null,
                errorMessage: 'AI results could not be parsed'
              }
            ],
            modelInfo: {
              name: 'AI Model (Error)',
              algorithmName: 'Unknown',
              algorithmVersion: 'Unknown'
            }
          };

          aiResults.push(errorResult);
        }
      });

      if (aiResults.length > 1) {
        this.uiNotificationService?.show({
          title: 'Multiple AI Results',
          message: `Found ${aiResults.length} AI results. Using the first one. Switch by clicking different AI thumbnails.`,
          type: 'warning',
          duration: 5000,
        });
      }

      return aiResults;

    } catch (error) {
      console.error('Error extracting AI results:', error);
      return [];
    }
  }

  /**
   * Find matching heatmap (SC) for an AI result (SR)
   */
  private findMatchingHeatmap(
    srDisplaySet: any,
    scDisplaySets: any[],
    modelName?: string
  ): any | null {
    if (!scDisplaySets.length) {
      return null;
    }

    const srDate = srDisplaySet.instance?.InstanceCreationDate;
    const srTime = srDisplaySet.instance?.InstanceCreationTime;
    const referencedSOPInstanceUID = srDisplaySet.instance?.ReferencedImageSequence?.[0]?.ReferencedSOPInstanceUID;

    // Try to find exact match first
    let matchingHeatmap = scDisplaySets.find(sc => {
      const scDate = sc.instance?.InstanceCreationDate;
      const scTime = sc.instance?.InstanceCreationTime;

      // Check date/time match
      const dateTimeMatch = srDate && srTime && scDate && scTime &&
                           srDate === scDate && srTime === scTime;

      // TODO: Add more sophisticated matching based on ReferencedSOPInstanceUID
      // and model name when we have examples of how these are stored in SC files

      return dateTimeMatch;
    });

    // If no exact match, try first SC as fallback
    if (!matchingHeatmap && scDisplaySets.length > 0) {
      console.warn('No exact heatmap match found, using first available SC display set');
      matchingHeatmap = scDisplaySets[0];
    }

    return matchingHeatmap;
  }

  /**
   * Find matching SR (structured report) for a heatmap (SC)
   * This is the reverse of findMatchingHeatmap
   */
  private findMatchingSRForHeatmap(
    scDisplaySet: any,
    srDisplaySets: any[]
  ): any | null {
    if (!srDisplaySets.length) {
      return null;
    }

    const scDate = scDisplaySet.instance?.InstanceCreationDate;
    const scTime = scDisplaySet.instance?.InstanceCreationTime;

    // Try to find exact match first
    let matchingSR = srDisplaySets.find(sr => {
      const srDate = sr.instance?.InstanceCreationDate;
      const srTime = sr.instance?.InstanceCreationTime;

      // Check date/time match
      const dateTimeMatch = scDate && scTime && srDate && srTime &&
                           scDate === srDate && scTime === srTime;

      return dateTimeMatch;
    });

    // If no exact match, try first SR as fallback
    if (!matchingSR && srDisplaySets.length > 0) {
      console.warn('No exact SR match found for SC, using first available SR display set');
      matchingSR = srDisplaySets[0];
    }

    return matchingSR;
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear();
  }

  /**
   * Get the primary (first) AI result for a study
   */
  getAIResults(studyInstanceUID: string, servicesManager: any): AIResult | null {
    const results = this.getAllAIResults(studyInstanceUID, servicesManager);
    return results.length > 0 ? results[0] : null;
  }

  /**
   * Get specific AI result by display set UID
   */
  getAIResultByDisplaySet(studyInstanceUID: string, displaySetInstanceUID: string, servicesManager: any): AIResult | null {
    const { displaySetService } = servicesManager.services;

    try {
      // Get the specific display set
      const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);
      if (!displaySet || displaySet.Modality !== 'SR') {
        return null;
      }

      // Get all AI results for the study
      const allResults = this.getAllAIResults(studyInstanceUID, servicesManager);

      // Find the result that matches this display set
      // We'll match by extracting data from the specific display set
      const aiResultData = extractAIResultData(displaySet);

      if (!aiResultData || (!aiResultData.classifications.length && !aiResultData.modelInfo)) {
        return null;
      }

      // Find matching heatmap
      const allDisplaySets = displaySetService.getActiveDisplaySets();
      const studyDisplaySets = allDisplaySets.filter(ds => ds.StudyInstanceUID === studyInstanceUID);
      const scDisplaySets = studyDisplaySets.filter(ds => ds.Modality === 'SC');

      const heatmapDisplaySet = this.findMatchingHeatmap(
        displaySet,
        scDisplaySets,
        aiResultData.modelInfo?.name
      );

      return {
        studyInstanceUID,
        hasHeatmap: !!heatmapDisplaySet,
        classifications: aiResultData.classifications,
        heatmapDisplaySet: heatmapDisplaySet,
        modelInfo: aiResultData.modelInfo ? {
          name: aiResultData.modelInfo.name,
          algorithmName: aiResultData.modelInfo.algorithmName || undefined,
          algorithmVersion: aiResultData.modelInfo.algorithmVersion || undefined
        } : undefined
      };
    } catch (error) {
      console.warn('Error getting AI result by display set:', error);
      return null;
    }
  }

  /**
   * Get AI result metadata for thumbnails
   */
  getAIResultMetadata(studyInstanceUID: string, servicesManager: any): Array<{
    displaySetInstanceUID: string;
    modelName: string;
    seriesDescription: string;
    isSelected: boolean;
  }> {
    const { displaySetService } = servicesManager.services;

    try {
      const allDisplaySets = displaySetService.getActiveDisplaySets();
      const studyDisplaySets = allDisplaySets.filter(ds => ds.StudyInstanceUID === studyInstanceUID);
      const srDisplaySets = studyDisplaySets.filter(ds => ds.Modality === 'SR');

      const selectedDisplaySetUID = this.selectedAIResults.get(studyInstanceUID);

      return srDisplaySets.map(displaySet => {
        const aiResultData = extractAIResultData(displaySet);
        return {
          displaySetInstanceUID: displaySet.displaySetInstanceUID,
          modelName: aiResultData?.modelInfo?.name || 'AI Model',
          seriesDescription: displaySet.SeriesDescription || 'AI Result',
          isSelected: displaySet.displaySetInstanceUID === selectedDisplaySetUID
        };
      });
    } catch (error) {
      console.warn('Error getting AI result metadata:', error);
      return [];
    }
  }

  /**
   * Set selected AI result with notification
   */
  setSelectedAIResult(studyInstanceUID: string, displaySetInstanceUID: string, servicesManager: any): void {
    const previousSelection = this.selectedAIResults.get(studyInstanceUID);

    // Don't do anything if it's already selected
    if (previousSelection === displaySetInstanceUID) {
      return;
    }

    const { displaySetService } = servicesManager.services;
    let targetDisplaySetUID = displaySetInstanceUID;
    let targetDisplaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);

    // If this is an SC (heatmap), find its matching SR for selection tracking
    if (targetDisplaySet && targetDisplaySet.Modality === 'SC') {
      // Find all SR display sets in this study
      const allDisplaySets = displaySetService.getActiveDisplaySets();
      const studyDisplaySets = allDisplaySets.filter(ds => ds.StudyInstanceUID === studyInstanceUID);
      const srDisplaySets = studyDisplaySets.filter(ds => ds.Modality === 'SR');

      // Find the SR that matches this SC (by timestamp or other criteria)
      const matchingSR = this.findMatchingSRForHeatmap(targetDisplaySet, srDisplaySets);

      if (matchingSR) {
        console.log(`SC clicked: ${displaySetInstanceUID}, using matching SR: ${matchingSR.displaySetInstanceUID}`);
        targetDisplaySetUID = matchingSR.displaySetInstanceUID;
        targetDisplaySet = matchingSR;
      } else {
        console.warn(`No matching SR found for SC: ${displaySetInstanceUID}`);
        return; // Can't proceed without matching SR
      }
    }

    // Update selection with the target SR
    this.selectedAIResults.set(studyInstanceUID, targetDisplaySetUID);

    // Get the AI result info for notification
    const aiResult = this.getAIResultByDisplaySet(studyInstanceUID, targetDisplaySetUID, servicesManager);

    if (aiResult && this.uiNotificationService) {
      const modelName = aiResult.modelInfo?.name || 'AI Model';

      let dateTimeInfo = '';
      if (targetDisplaySet?.instance) {
        const creationDate = targetDisplaySet.instance.InstanceCreationDate;
        const creationTime = targetDisplaySet.instance.InstanceCreationTime;

        if (creationDate && creationTime) {
          // Format DICOM date (YYYYMMDD) and time (HHMMSS.FFFFFF)
          const year = creationDate.substring(0, 4);
          const month = creationDate.substring(4, 6);
          const day = creationDate.substring(6, 8);

          const hour = creationTime.substring(0, 2);
          const minute = creationTime.substring(2, 4);
          const second = creationTime.substring(4, 6);

          const formattedDate = `${year}-${month}-${day}`;
          const formattedTime = `${hour}:${minute}:${second}`;
          dateTimeInfo = ` (Created: ${formattedDate} ${formattedTime})`;
        } else if (creationDate) {
          // Fallback to just date if time is not available
          const year = creationDate.substring(0, 4);
          const month = creationDate.substring(4, 6);
          const day = creationDate.substring(6, 8);
          const formattedDate = `${year}-${month}-${day}`;
          dateTimeInfo = ` (Created: ${formattedDate})`;
        }
      }

      this.uiNotificationService.show({
        title: 'AI Result Switched',
        message: `Now viewing: ${modelName}${dateTimeInfo}`,
        type: 'info',
        duration: 3000, // Increased duration since message is longer
      });
    }
  }

  /**
   * Get currently selected AI result
   */
  getSelectedAIResult(studyInstanceUID: string, servicesManager: any): AIResult | null {
    const selectedDisplaySetUID = this.selectedAIResults.get(studyInstanceUID);

    if (selectedDisplaySetUID) {
      return this.getAIResultByDisplaySet(studyInstanceUID, selectedDisplaySetUID, servicesManager);
    }

    // If no selection, return the primary (first) result and set it as selected
    const primaryResult = this.getAIResults(studyInstanceUID, servicesManager);
    if (primaryResult) {
      // Find the display set UID for the primary result
      const metadata = this.getAIResultMetadata(studyInstanceUID, servicesManager);
      if (metadata.length > 0) {
        this.selectedAIResults.set(studyInstanceUID, metadata[0].displaySetInstanceUID);
      }
    }

    return primaryResult;
  }
}

// Export singleton instance
let aiResultsServiceInstance: AIResultsService | null = null;

export function getAIResultsService(uiNotificationService?: any): AIResultsService {
  if (!aiResultsServiceInstance) {
    aiResultsServiceInstance = new AIResultsService(uiNotificationService);
  }
  return aiResultsServiceInstance;
}

/**
 * Legacy function for backward compatibility
 * Returns the primary AI result for a study
 */
export function getAIResults(studyInstanceUID: string, servicesManager: any): AIResult | null {
  const service = getAIResultsService(servicesManager.services?.uiNotificationService);
  const primaryResult = service.getAIResults(studyInstanceUID, servicesManager);

  if (!primaryResult) {
    return {
      studyInstanceUID,
      hasHeatmap: false,
      classifications: [
        {
          side: 'Left',
          isMalignant: null,
          confidence: null,
          errorMessage: 'No AI results found'
        },
        {
          side: 'Right',
          isMalignant: null,
          confidence: null,
          errorMessage: 'No AI results found'
        }
      ],
      modelInfo: {
        name: 'No AI Results',
        algorithmName: 'N/A',
        algorithmVersion: 'N/A'
      }
    };
  }

  return primaryResult;
}
