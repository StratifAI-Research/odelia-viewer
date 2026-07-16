import { useState, useCallback } from 'react';

export type WizardStep = 1 | 2 | 3 | 4 | 5;

export function useWizardState(initialStep: WizardStep = 1) {
  const [currentStep, setCurrentStep] = useState<WizardStep>(initialStep);

  // OAR-L6/L7: return referentially-stable callbacks (functional-updater form,
  // empty deps) so consumers' effects don't churn on every render.
  // goToNextStep/goToPrevStep are part of the wizard's public API (sequential
  // navigation); the current UI drives steps via goToStep/reset, but these stay
  // exported as the supported step-navigation interface.
  const goToNextStep = useCallback(() => {
    setCurrentStep(s => (s < 5 ? ((s + 1) as WizardStep) : s));
  }, []);

  const goToPrevStep = useCallback(() => {
    setCurrentStep(s => (s > 1 ? ((s - 1) as WizardStep) : s));
  }, []);

  const goToStep = useCallback((step: WizardStep) => {
    setCurrentStep(step);
  }, []);

  const reset = useCallback(() => {
    setCurrentStep(1);
  }, []);

  return {
    currentStep,
    goToNextStep,
    goToPrevStep,
    goToStep,
    reset,
  };
}
