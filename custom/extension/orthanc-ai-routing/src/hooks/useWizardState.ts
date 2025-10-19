import { useState } from 'react';

export type WizardStep = 1 | 2 | 3 | 4;

export function useWizardState(initialStep: WizardStep = 1) {
  const [currentStep, setCurrentStep] = useState<WizardStep>(initialStep);

  const goToNextStep = () => {
    if (currentStep < 4) {
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
