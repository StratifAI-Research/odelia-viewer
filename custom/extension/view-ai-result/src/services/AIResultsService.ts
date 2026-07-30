import { AIResult } from '../types';
import { extractAIResultData } from '../utils/extractAIResultData';
import { findMatchingSRForHeatmap } from '../utils/aiResultPairing';
import { formatDicomDateTime } from '../utils/dicomDateTime';
import {
  buildAIResult,
  extractAIResultsForStudy,
  hasUsableAIResultData,
} from './aiResultExtraction';

/**
 * Stateful repository + event bus for AI results.
 *
 * The pure work — extracting results from DICOM display sets and pairing an SR
 * with its heatmap SC — lives in `./aiResultExtraction` and
 * `../utils/aiResultPairing`. This class owns only the stateful
 * concerns: the per-study result cache, the selection map, the event bus, and
 * UI notifications.
 */
export class AIResultsService {
  private cache: Map<string, AIResult[]> = new Map();
  private selectedAIResults: Map<string, string> = new Map(); // studyUID -> displaySetUID
  private uiNotificationService: any;
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

  private getStudyDisplaySets(studyInstanceUID: string, servicesManager: any): any[] {
    const { displaySetService } = servicesManager.services;
    const allDisplaySets = displaySetService.getActiveDisplaySets();
    return allDisplaySets.filter((ds: any) => ds.StudyInstanceUID === studyInstanceUID);
  }

  /**
   * Get all AI results for a study, with caching
   */
  getAllAIResults(studyInstanceUID: string, servicesManager: any): AIResult[] {
    this.ensureDisplaySetInvalidation(servicesManager);

    // Check cache first
    if (this.cache.has(studyInstanceUID)) {
      return this.cache.get(studyInstanceUID)!;
    }

    const results = this.extractAIResultsFromStudy(studyInstanceUID, servicesManager);
    this.cache.set(studyInstanceUID, results);

    // If no results found, publish cleared event
    if (results.length === 0) {
      this.publish(AIResultsService.EVENTS.AI_RESULT_CLEARED, {
        studyInstanceUID,
        reason: 'no_results',
      });
    }

    return results;
  }

  /**
   * Extract AI results from all SR display sets in a study (delegates the pure
   * work to `extractAIResultsForStudy`; keeps only the UI-notification side
   * effect that belongs to the stateful service).
   */
  private extractAIResultsFromStudy(studyInstanceUID: string, servicesManager: any): AIResult[] {
    try {
      const studyDisplaySets = this.getStudyDisplaySets(studyInstanceUID, servicesManager);
      const aiResults = extractAIResultsForStudy(studyDisplaySets, studyInstanceUID);

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
      reason: 'cache_cleared',
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
    const updatedResults = cachedResults.filter(
      result =>
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
      displaySetUIDs,
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
  getAIResultByDisplaySet(
    studyInstanceUID: string,
    displaySetInstanceUID: string,
    servicesManager: any
  ): AIResult | null {
    const { displaySetService } = servicesManager.services;

    try {
      // Get the specific display set
      const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);

      if (!displaySet || displaySet.Modality !== 'SR') {
        return null;
      }

      // Warm the cache / register display-set invalidation for this study.
      this.getAllAIResults(studyInstanceUID, servicesManager);

      const aiResultData = extractAIResultData(displaySet);
      if (!hasUsableAIResultData(aiResultData)) {
        return null;
      }

      const scDisplaySets = this.getStudyDisplaySets(studyInstanceUID, servicesManager).filter(
        (ds: any) => ds.Modality === 'SC'
      );

      return buildAIResult(displaySet, aiResultData!, scDisplaySets, studyInstanceUID);
    } catch (error) {
      console.warn('Error getting AI result by display set:', error);
      return null;
    }
  }

  /**
   * Get AI result metadata for thumbnails
   */
  getAIResultMetadata(
    studyInstanceUID: string,
    servicesManager: any
  ): Array<{
    displaySetInstanceUID: string;
    modelName: string;
    seriesDescription: string;
    isSelected: boolean;
  }> {
    try {
      const srDisplaySets = this.getStudyDisplaySets(studyInstanceUID, servicesManager).filter(
        (ds: any) => ds.Modality === 'SR'
      );

      const selectedDisplaySetUID = this.selectedAIResults.get(studyInstanceUID);

      return srDisplaySets.map((displaySet: any) => {
        const aiResultData = extractAIResultData(displaySet);
        return {
          displaySetInstanceUID: displaySet.displaySetInstanceUID,
          modelName: aiResultData?.modelInfo?.name || 'AI Model',
          seriesDescription: displaySet.SeriesDescription || 'AI Result',
          isSelected: displaySet.displaySetInstanceUID === selectedDisplaySetUID,
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
  setSelectedAIResult(
    studyInstanceUID: string,
    displaySetInstanceUID: string,
    servicesManager: any
  ): void {
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
      const srDisplaySets = this.getStudyDisplaySets(studyInstanceUID, servicesManager).filter(
        (ds: any) => ds.Modality === 'SR'
      );

      // Find the SR that matches this SC (by referenced UID / timestamp proximity)
      const matchingSR = findMatchingSRForHeatmap(targetDisplaySet, srDisplaySets);

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
    const aiResult = this.getAIResultByDisplaySet(
      studyInstanceUID,
      targetDisplaySetUID,
      servicesManager
    );

    // Publish AI_RESULT_SELECTED event, including the original clicked UID (could be SC)
    this.publish(this.EVENTS.AI_RESULT_SELECTED, {
      studyInstanceUID,
      displaySetInstanceUID: targetDisplaySetUID, // SR UID actually selected
      clickedDisplaySetInstanceUID: displaySetInstanceUID, // Original thumbnail clicked (SC or SR)
      aiResult,
    });

    // Show notification
    if (aiResult && this.uiNotificationService) {
      const modelName = aiResult.modelInfo?.name || 'AI Model';

      // Reuse the shared DICOM date/time formatter instead of
      // re-implementing the YYYYMMDD/HHMMSS slicing here.
      let dateTimeInfo = '';
      if (targetDisplaySet?.instance) {
        const creationDate = targetDisplaySet.instance.InstanceCreationDate;
        const creationTime = targetDisplaySet.instance.InstanceCreationTime;
        const formatted = formatDicomDateTime(creationDate, creationTime);
        if (formatted) {
          // Drop the "00:00:00" clock when no time component was present.
          const label = creationTime ? formatted : formatted.replace(/ 00:00:00$/, '');
          dateTimeInfo = ` (Created: ${label})`;
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

    // No explicit selection yet — return the primary (first) result
    // WITHOUT persisting a selection from this read path. This getter is called
    // from render, and a getter must not mutate service state. The default
    // selection is established by `notifyStudyChange` when a study loads.
    return this.getAIResults(studyInstanceUID, servicesManager);
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
        this.setSelectedAIResult(
          studyInstanceUID,
          firstResult.displaySetInstanceUID,
          servicesManager
        );
      }
    }
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
      },
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
