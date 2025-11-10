import { useEffect, useCallback, useRef } from 'react';

interface StudyChangeDetectorConfig {
  servicesManager: any;
  viewportGridService: any;
  displaySetService: any;
  activeViewportId: string | null;
  viewports: Map<string, any>;
  StudyInstanceUIDs: string[];
}

/**
 * Hook to detect when the active study changes in the viewport
 * Publishes STUDY_CHANGED event via AIResultsService
 */
export const useStudyChangeDetector = (config: StudyChangeDetectorConfig): void => {
  const {
    servicesManager,
    viewportGridService,
    displaySetService,
    activeViewportId,
    viewports,
    StudyInstanceUIDs,
  } = config;

  const { aiResultsService } = servicesManager.services || {};
  const activeStudyUIDRef = useRef<string | null>(null);

  // Helper to extract study UID from the active viewport
  const getStudyUIDFromActiveViewport = useCallback((): string | null => {
    if (!activeViewportId || !viewports) {
      return StudyInstanceUIDs?.[0] || null; // Fallback to first study
    }

    const activeViewport = viewports.get(activeViewportId);
    const displaySetInstanceUIDs = activeViewport?.displaySetInstanceUIDs || [];

    if (!displaySetInstanceUIDs.length) {
      return StudyInstanceUIDs?.[0] || null; // Fallback to first study
    }

    // Get the first display set's study UID
    const firstDisplaySetUID = displaySetInstanceUIDs[0];
    const displaySet = displaySetService?.getDisplaySetByUID(firstDisplaySetUID);

    return displaySet?.StudyInstanceUID || displaySet?.studyInstanceUID || null;
  }, [activeViewportId, viewports, displaySetService, StudyInstanceUIDs]);

  // Track viewport changes and detect study changes
  useEffect(() => {
    if (!aiResultsService) {
      return;
    }

    const studyUID = getStudyUIDFromActiveViewport();

    if (!studyUID) {
      return;
    }

    // Check if study actually changed
    if (studyUID !== activeStudyUIDRef.current) {
      console.log(`[useStudyChangeDetector] Study changed from ${activeStudyUIDRef.current} to ${studyUID}`);
      activeStudyUIDRef.current = studyUID;

      // Notify the service about the study change
      aiResultsService.notifyStudyChange(studyUID, servicesManager);
    }
  }, [
    activeViewportId,
    viewports,
    getStudyUIDFromActiveViewport,
    aiResultsService,
    servicesManager,
  ]);

  // Initialize on mount
  useEffect(() => {
    if (!aiResultsService || activeStudyUIDRef.current) {
      return;
    }

    const initialStudyUID = getStudyUIDFromActiveViewport();
    if (initialStudyUID) {
      console.log(`[useStudyChangeDetector] Initial study: ${initialStudyUID}`);
      activeStudyUIDRef.current = initialStudyUID;
      aiResultsService.notifyStudyChange(initialStudyUID, servicesManager);
    }
  }, [aiResultsService, getStudyUIDFromActiveViewport, servicesManager]);
};
