import { useState, useEffect } from 'react';
import { AIResult } from '../types';

export const useAIResult = (displaySets: any[], servicesManager: any): AIResult | null => {
  const [aiResult, setAIResult] = useState<AIResult | null>(null);

  useEffect(() => {
    if (displaySets.length > 0) {
      const studyInstanceUID = displaySets[0].StudyInstanceUID;
      // Use the extension-registered service (registered in preRegistration) so the
      // viewport's initial AI result shares selection state with every other consumer.
      const aiResultsService = servicesManager?.services?.aiResultsService;
      if (studyInstanceUID && aiResultsService) {
        const result = aiResultsService.getSelectedAIResult(studyInstanceUID, servicesManager);
        setAIResult(result);
      }
    }
  }, [displaySets, servicesManager]);

  return aiResult;
};
