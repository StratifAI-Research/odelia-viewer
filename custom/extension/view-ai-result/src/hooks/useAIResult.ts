import { useState, useEffect } from 'react';
import { AIResult } from '../types';
import { getAIResultsService } from '../services/AIResultsService';

export const useAIResult = (displaySets: any[], servicesManager: any): AIResult | null => {
  const [aiResult, setAIResult] = useState<AIResult | null>(null);

  useEffect(() => {
    if (displaySets.length > 0) {
      const studyInstanceUID = displaySets[0].StudyInstanceUID;
      if (studyInstanceUID) {
        const aiResultsService = getAIResultsService();
        const result = aiResultsService.getSelectedAIResult(studyInstanceUID, servicesManager);
        setAIResult(result);
      }
    }
  }, [displaySets, servicesManager]);

  return aiResult;
};
