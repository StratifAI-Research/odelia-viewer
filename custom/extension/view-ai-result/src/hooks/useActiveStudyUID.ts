import { useCallback } from 'react';

interface ActiveStudyUIDConfig {
  activeViewportId: string | null;
  viewports: Map<string, any> | null | undefined;
  displaySetService: any;
  StudyInstanceUIDs: string[] | undefined;
}

/**
 * Returns a stable callback that resolves the StudyInstanceUID of the active
 * viewport's first display set, falling back to the first entry of
 * StudyInstanceUIDs. Shared by ChatPanel, FeedbackPanel, and
 * useStudyChangeDetector (which previously each held an identical copy).
 */
export function useActiveStudyUID({
  activeViewportId,
  viewports,
  displaySetService,
  StudyInstanceUIDs,
}: ActiveStudyUIDConfig): () => string | null {
  return useCallback((): string | null => {
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
}
