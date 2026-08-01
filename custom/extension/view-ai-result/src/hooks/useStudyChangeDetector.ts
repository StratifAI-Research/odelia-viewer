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

  // Track viewport changes and detect study changes. This also covers the
  // initial resolve: on mount the ref is null, so the first non-null study UID
  // already reads as a change. A separate mount effect duplicated that.
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
};
