import { renderHook, act } from '@testing-library/react';
import { useWizardState } from './useWizardState';

describe('useWizardState', () => {
  it('starts at the initial step and clamps next/prev at the bounds', () => {
    const { result } = renderHook(() => useWizardState(1));
    expect(result.current.currentStep).toBe(1);

    act(() => result.current.goToPrevStep());
    expect(result.current.currentStep).toBe(1); // clamped low

    for (let i = 0; i < 6; i++) {
      act(() => result.current.goToNextStep());
    }
    expect(result.current.currentStep).toBe(5); // clamped high
  });

  it('defaults to step 1 when no initial step is given', () => {
    const { result } = renderHook(() => useWizardState());
    expect(result.current.currentStep).toBe(1);
  });

  it('goToStep jumps to an arbitrary step and reset returns to 1', () => {
    const { result } = renderHook(() => useWizardState(3));
    expect(result.current.currentStep).toBe(3);

    act(() => result.current.goToStep(4));
    expect(result.current.currentStep).toBe(4);

    act(() => result.current.goToPrevStep());
    expect(result.current.currentStep).toBe(3); // decrements when above the floor

    act(() => result.current.reset());
    expect(result.current.currentStep).toBe(1);
  });
});
