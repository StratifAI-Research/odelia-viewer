import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { EndpointSelectionStep } from './EndpointSelectionStep';
import { AI_ENDPOINT } from '../../test-utils/harness';

const base = {
  currentEndpoint: AI_ENDPOINT,
  studyDescription: 'Brain MR',
  selectedSeriesCount: 3,
  onSend: () => {},
  onBack: () => {},
};

describe('EndpointSelectionStep', () => {
  it('renders the summary of model, study, and series count', () => {
    render(<EndpointSelectionStep {...base} />);
    expect(screen.getByText(/Model: test-ai/)).toBeTruthy();
    expect(screen.getByText(/Study: Brain MR/)).toBeTruthy();
    expect(screen.getByText(/Series: 3 selected/)).toBeTruthy();
  });

  it('shows "Not configured" and disables Send when no endpoint', () => {
    render(<EndpointSelectionStep {...base} currentEndpoint={null} />);
    expect(screen.getByText(/Model: Not configured/)).toBeTruthy();
    expect(screen.getByText('Send to AI').closest('button')!.disabled).toBe(true);
  });

  it('renders an error banner and the input-mapping section when provided', () => {
    render(
      <EndpointSelectionStep {...base} error="something failed" inputMappingDescription="T1 -> s1" />
    );
    expect(screen.getByText('something failed')).toBeTruthy();
    expect(screen.getByText('Input Mapping')).toBeTruthy();
    expect(screen.getByText('T1 -> s1')).toBeTruthy();
  });

  it('fires onSend and onBack', () => {
    const onSend = jest.fn();
    const onBack = jest.fn();
    render(<EndpointSelectionStep {...base} onSend={onSend} onBack={onBack} />);
    fireEvent.click(screen.getByText('Send to AI'));
    fireEvent.click(screen.getByText(/Back/));
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
