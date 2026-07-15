import { AIResult, Classification } from '../types';
import { extractAIResultData } from '../utils/extractAIResultData';
import { resultTsFromDisplaySet } from '../utils/dicomDateTime';

/**
 * Service for extracting AI results from DICOM files
 */
export class AIResultsService {
  private cache: Map<string, AIResult[]> = new Map();
  private selectedAIResults: Map<string, string> = new Map(); // studyUID -> displaySetUID
  private uiNotificationService: any;
  private selectionChangeListeners: Map<string, Array<() => void>> = new Map(); // studyUID -> callbacks
  private eventListeners: Map<string, Array<(data: any) => void>> = new Map(); // event -> callbacks
  private currentStudyUID: string | null = null; // Track current active study
  private displaySetService: any = null; // set lazily; used to invalidate the cache when display sets load

  // Event constants
  static EVENTS = {
    AI_RESULT_SELECTED: 'AI_RESULT_SELECTED',
    AI_RESULT_UPDATED: 'AI_RESULT_UPDATED',
    AI_RESULT_CLEARED: 'AI_RESULT_CLEARED',
    STUDY_CHANGED: 'STUDY_CHANGED',
  };

  // Instance method to access events
  EVENTS = AIResultsService.EVENTS;

  constructor(uiNotificationService: any) {
    this.uiNotificationService = uiNotificationService;
  }

  /**
   * Subscribe (once) to displaySetService so the per-study result cache is
   * invalidated when display sets load. SR and SC series stream in
   * asynchronously; if a study's results were cached from the SR before its
   * matching SC (heatmap) display set arrived, `hasHeatmap` was frozen as
   * `false` and the heatmap toggle stayed permanently unavailable. Dropping the
   * cache on DISPLAY_SETS_ADDED lets the next read recompute against the now
   * complete set. Lazy because the service only receives servicesManager per call.
   */
  private ensureDisplaySetInvalidation(servicesManager: any): void {
    if (this.displaySetService) {
      return;
    }
    const displaySetService = servicesManager?.services?.displaySetService;
    const addedEvent = displaySetService?.EVENTS?.DISPLAY_SETS_ADDED;
    if (!displaySetService?.subscribe || !addedEvent) {
      return;
    }
    this.displaySetService = displaySetService;
    displaySetService.subscribe(addedEvent, () => {
      this.cache.clear();
    });
  }

  /**
   * Get all AI results for a study, with caching
   */
  getAllAIResults(studyInstanceUID: string, servicesManager: any): AIResult[] {
    this.ensureDisplaySetInvalidation(servicesManager);

    // Check cache first
    if (this.cache.has(studyInstanceUID)) {
      const cachedResults = this.cache.get(studyInstanceUID)!;

      return cachedResults;
    }

    const results = this.extractAIResultsFromStudy(studyInstanceUID, servicesManager);

    this.cache.set(studyInstanceUID, results);

    // If no results found, publish cleared event
    if (results.length === 0) {

      this.publish(AIResultsService.EVENTS.AI_RESULT_CLEARED, {
        studyInstanceUID,
        reason: 'no_results'
      });
    }

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

            const resultTs = resultTsFromDisplaySet(srDisplaySet);

            const aiResult: AIResult = {
              studyInstanceUID,
              displaySetInstanceUID: srDisplaySet.displaySetInstanceUID,
              hasHeatmap: !!heatmapDisplaySet,
              classifications: aiResultData.classifications,
              resultTs,
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
          const resultTs = resultTsFromDisplaySet(srDisplaySet);
          const errorResult: AIResult = {
            studyInstanceUID,
            displaySetInstanceUID: srDisplaySet.displaySetInstanceUID,
            hasHeatmap: false,
            classifications: [
              {
                side: 'Left',
                result: null,
                confidence: null,
                errorMessage: 'AI results could not be parsed'
              },
              {
                side: 'Right',
                result: null,
                confidence: null,
                errorMessage: 'AI results could not be parsed'
              }
            ],
            resultTs,
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

    // Try to find exact match by date/time
    const matchingHeatmap = scDisplaySets.find(sc => {
      const scDate = sc.instance?.InstanceCreationDate;
      const scTime = sc.instance?.InstanceCreationTime;

      // Check date/time match
      const dateTimeMatch = srDate && srTime && scDate && scTime &&
                           srDate === scDate && srTime === scTime;

      // TODO: Add more sophisticated matching based on ReferencedSOPInstanceUID
      // and model name when we have examples of how these are stored in SC files

      return dateTimeMatch;
    });

    if (!matchingHeatmap) {

      return null;
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

    // Try to find exact match by date/time
    const matchingSR = srDisplaySets.find(sr => {
      const srDate = sr.instance?.InstanceCreationDate;
      const srTime = sr.instance?.InstanceCreationTime;

      // Check date/time match
      const dateTimeMatch = scDate && scTime && srDate && srTime &&
                           scDate === srDate && scTime === srTime;

      return dateTimeMatch;
    });

    if (!matchingSR) {

      return null;
    }

    return matchingSR;
  }

  /**
   * Clear cache
   */
  /**
   * Add listener for selection changes
   */
  addSelectionChangeListener(studyInstanceUID: string, callback: () => void): void {
    if (!this.selectionChangeListeners.has(studyInstanceUID)) {
      this.selectionChangeListeners.set(studyInstanceUID, []);
    }
    this.selectionChangeListeners.get(studyInstanceUID)!.push(callback);
  }

  /**
   * Remove listener for selection changes
   */
  removeSelectionChangeListener(studyInstanceUID: string, callback: () => void): void {
    const listeners = this.selectionChangeListeners.get(studyInstanceUID);
    if (listeners) {
      const index = listeners.indexOf(callback);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
  }

  /**
   * Notify all listeners of selection change
   */
  private notifySelectionChange(studyInstanceUID: string): void {
    const listeners = this.selectionChangeListeners.get(studyInstanceUID);

    if (listeners) {
      listeners.forEach((callback, index) => {
        try {

          callback();
        } catch (error) {
          console.warn('Error in selection change listener:', error);
        }
      });
    }
  }

  clearCache(): void {
    this.cache.clear();
    this.selectionChangeListeners.clear();
  }

  /**
   * Clear cache for a specific study
   */
  clearStudyCache(studyInstanceUID: string): void {

    this.cache.delete(studyInstanceUID);

    // Also clear selection if it exists
    if (this.selectedAIResults.has(studyInstanceUID)) {
      this.selectedAIResults.delete(studyInstanceUID);
    }

    // Publish cleared event
    this.publish(AIResultsService.EVENTS.AI_RESULT_CLEARED, {
      studyInstanceUID,
      reason: 'cache_cleared'
    });
  }

  /**
   * Remove specific display sets from cache
   * Call this after deleting AI results to invalidate cache
   */
  removeDisplaySetsFromCache(studyInstanceUID: string, displaySetUIDs: string[]): void {

    // Get cached results
    const cachedResults = this.cache.get(studyInstanceUID);
    if (!cachedResults) {

      return;
    }

    // Filter out deleted display sets
    const updatedResults = cachedResults.filter(result =>
      !result.displaySetInstanceUID || !displaySetUIDs.includes(result.displaySetInstanceUID)
    );

    // Update cache
    if (updatedResults.length > 0) {
      this.cache.set(studyInstanceUID, updatedResults);

    } else {
      // No results left, clear the study cache
      this.cache.delete(studyInstanceUID);
      this.selectedAIResults.delete(studyInstanceUID);

    }

    // Clear selection if the selected result was deleted
    const selectedUID = this.selectedAIResults.get(studyInstanceUID);
    if (selectedUID && displaySetUIDs.includes(selectedUID)) {
      this.selectedAIResults.delete(studyInstanceUID);

    }

    // Publish cache cleared event
    this.publish(AIResultsService.EVENTS.AI_RESULT_CLEARED, {
      studyInstanceUID,
      displaySetUIDs
    });
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

      const resultTs = resultTsFromDisplaySet(displaySet);

      return {
        studyInstanceUID,
        displaySetInstanceUID: displaySetInstanceUID,
        hasHeatmap: !!heatmapDisplaySet,
        classifications: aiResultData.classifications,
        resultTs,
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

        targetDisplaySetUID = matchingSR.displaySetInstanceUID;
        targetDisplaySet = matchingSR;
      } else {
        console.warn(`No matching SR found for SC: ${displaySetInstanceUID}`);
        return; // Can't proceed without matching SR
      }
    }

    // Update selection with the target SR
    this.selectedAIResults.set(studyInstanceUID, targetDisplaySetUID);

    // Get the AI result for the event
    const aiResult = this.getAIResultByDisplaySet(studyInstanceUID, targetDisplaySetUID, servicesManager);

    // Publish AI_RESULT_SELECTED event, including the original clicked UID (could be SC)
    this.publish(this.EVENTS.AI_RESULT_SELECTED, {
      studyInstanceUID,
      displaySetInstanceUID: targetDisplaySetUID,           // SR UID actually selected
      clickedDisplaySetInstanceUID: displaySetInstanceUID,  // Original thumbnail clicked (SC or SR)
      aiResult
    });

    // Notify listeners of selection change (legacy)
    this.notifySelectionChange(studyInstanceUID);

    // Show notification
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

      const result = this.getAIResultByDisplaySet(studyInstanceUID, selectedDisplaySetUID, servicesManager);

      return result;
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

  /**
   * Notify about study change - call this when active study changes
   */
  notifyStudyChange(studyInstanceUID: string, servicesManager: any): void {
    const previousStudyUID = this.currentStudyUID;

    // Only publish if study actually changed
    if (previousStudyUID === studyInstanceUID) {
      return;
    }

    this.currentStudyUID = studyInstanceUID;

    // Get AI results for the new study
    const aiResults = this.getAllAIResults(studyInstanceUID, servicesManager);
    const hasAIResults = aiResults.length > 0;

    // Publish study changed event
    this.publish(AIResultsService.EVENTS.STUDY_CHANGED, {
      previousStudyUID,
      currentStudyUID: studyInstanceUID,
      hasAIResults,
      aiResults,
    });

    // If new study has AI results, auto-select the first one
    if (hasAIResults && !this.selectedAIResults.has(studyInstanceUID)) {
      const firstResult = aiResults[0];
      if (firstResult.displaySetInstanceUID) {

        this.setSelectedAIResult(studyInstanceUID, firstResult.displaySetInstanceUID, servicesManager);
      }
    }
  }

  /**
   * Get current active study UID
   */
  getCurrentStudyUID(): string | null {
    return this.currentStudyUID;
  }

  /**
   * Subscribe to events
   */
  subscribe(eventName: string, callback: (data: any) => void): { unsubscribe: () => void } {
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, []);
    }
    this.eventListeners.get(eventName)!.push(callback);

    return {
      unsubscribe: () => {
        const listeners = this.eventListeners.get(eventName);
        if (listeners) {
          const index = listeners.indexOf(callback);
          if (index > -1) {
            listeners.splice(index, 1);
          }
        }
      }
    };
  }

  /**
   * Publish events
   */
  private publish(eventName: string, data: any): void {
    const listeners = this.eventListeners.get(eventName);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`Error in event listener for ${eventName}:`, error);
        }
      });
    }
  }
}
