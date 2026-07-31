import { useEffect, useRef } from 'react';
import { useActiveStudyUID } from './useActiveStudyUID';

interface StudyChangeDetectorConfig {
  servicesManager: AppTypes.ServicesManager;
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
    displaySetService,
    activeViewportId,
    viewports,
    StudyInstanceUIDs,
  } = config;

  const { aiResultsService } = servicesManager.services || {};
  const activeStudyUIDRef = useRef<string | null>(null);

  // Helper to extract study UID from the active viewport
  const getStudyUIDFromActiveViewport = useActiveStudyUID({
    activeViewportId,
    viewports,
    displaySetService,
    StudyInstanceUIDs,
  });

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
      activeStudyUIDRef.current = initialStudyUID;
      aiResultsService.notifyStudyChange(initialStudyUID, servicesManager);
    }
  }, [aiResultsService, getStudyUIDFromActiveViewport, servicesManager]);
};
