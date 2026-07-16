import { useState } from 'react';

export type WizardStep = 1 | 2 | 3 | 4 | 5;

export function useWizardState(initialStep: WizardStep = 1) {
  const [currentStep, setCurrentStep] = useState<WizardStep>(initialStep);

  // goToNextStep/goToPrevStep are part of the wizard's public API (sequential
  // navigation); the current UI drives steps via goToStep/reset, but these stay
  // exported as the supported step-navigation interface.
  const goToNextStep = () => {
    if (currentStep < 5) {
      setCurrentStep((currentStep + 1) as WizardStep);
    }
  };

  const goToPrevStep = () => {
    if (currentStep > 1) {
      setCurrentStep((currentStep - 1) as WizardStep);
    }
  };

  const goToStep = (step: WizardStep) => {
    setCurrentStep(step);
  };

  const reset = () => {
    setCurrentStep(1);
  };

  return {
    currentStep,
    goToNextStep,
    goToPrevStep,
    goToStep,
    reset,
  };
}


