import { useState, useEffect } from 'react';
import { AIResult } from '../types';

export const useAIResult = (
  displaySets: any[],
  servicesManager: AppTypes.ServicesManager
): AIResult | null => {
  const studyInstanceUID: string | undefined =
    displaySets.length > 0 ? displaySets[0].StudyInstanceUID : undefined;

  // Track which study the resolved result belongs to.
  const [resolved, setResolved] = useState<{ uid?: string; result: AIResult | null }>({
    result: null,
  });

  useEffect(() => {
    if (studyInstanceUID) {
      // Use the extension-registered service (registered in preRegistration) so the
      // viewport's initial AI result shares selection state with every other consumer.
      const aiResultsService = servicesManager?.services?.aiResultsService;
      if (aiResultsService) {
        const result = aiResultsService.getSelectedAIResult(studyInstanceUID, servicesManager);
        setResolved({ uid: studyInstanceUID, result });
        return;
      }
    }
    setResolved({ uid: studyInstanceUID, result: null });
  }, [studyInstanceUID, servicesManager]);

  // Only surface a result resolved for the current study; return null until the
  // effect re-resolves after a study change.
  return resolved.uid === studyInstanceUID ? resolved.result : null;
};
