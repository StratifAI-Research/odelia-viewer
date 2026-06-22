import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { InputModeSelectionStep } from './InputModeSelectionStep';
import type { ModelManifest } from '../../services/OrthancAIService';

const manifest: ModelManifest = {
  model_id: 'm',
  model_name: 'M',
  version: '1',
  input_configurations: [
    { id: 'c1', name: 'Single input', description: 'one series', inputs: [{ key: 'a', label: 'A', required: true }] },
    { id: 'c2', name: 'Dual input', inputs: [
      { key: 'a', label: 'A', required: true },
      { key: 'b', label: 'B', required: true },
    ] },
  ],
};

const base = {
  manifest,
  selectedConfigId: null as string | null,
  onSelectConfig: () => {},
  onNext: () => {},
  onBack: () => {},
};

describe('InputModeSelectionStep', () => {
  it('renders a radio per config with description and input count', () => {
    render(<InputModeSelectionStep {...base} />);
    expect(screen.getByText('Single input')).toBeTruthy();
    expect(screen.getByText('one series')).toBeTruthy();
    expect(screen.getByText('1 input required')).toBeTruthy();
    expect(screen.getByText('2 inputs required')).toBeTruthy(); // pluralized
  });

  it('reflects the selected config and disables Next until one is chosen', () => {
    const { rerender } = render(<InputModeSelectionStep {...base} />);
    expect(screen.getByText(/Next/).closest('button')!.disabled).toBe(true);
    rerender(<InputModeSelectionStep {...base} selectedConfigId="c1" />);
    expect(screen.getByText(/Next/).closest('button')!.disabled).toBe(false);
  });

  it('calls onSelectConfig when a radio is chosen', () => {
    const onSelectConfig = jest.fn();
    render(<InputModeSelectionStep {...base} onSelectConfig={onSelectConfig} />);
    fireEvent.click(screen.getAllByRole('radio')[1]);
    expect(onSelectConfig).toHaveBeenCalledWith('c2');
  });

  it('fires onNext and onBack', () => {
    const onNext = jest.fn();
    const onBack = jest.fn();
    render(<InputModeSelectionStep {...base} selectedConfigId="c1" onNext={onNext} onBack={onBack} />);
    fireEvent.click(screen.getByText(/Next/));
    fireEvent.click(screen.getByText(/Back/));
    expect(onNext).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
