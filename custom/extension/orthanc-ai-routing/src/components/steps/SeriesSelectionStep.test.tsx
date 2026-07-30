import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SeriesSelectionStep } from './SeriesSelectionStep';
import type { SeriesInfo } from '../SeriesSelector';

function series(over: Partial<SeriesInfo> = {}): SeriesInfo {
  return {
    displaySetInstanceUID: 'd',
    SeriesInstanceUID: 's1',
    SeriesDescription: 'T1',
    SeriesNumber: 1,
    Modality: 'MR',
    numImageFrames: 4,
    StudyInstanceUID: 'st',
    ...over,
  };
}

const base = {
  series: [series()],
  selectedSeriesUIDs: new Set(['s1']),
  onToggleSeries: () => {},
  onSelectAll: () => {},
  onClearSelection: () => {},
  onNext: () => {},
};

describe('SeriesSelectionStep', () => {
  it('renders the error state with a working retry', () => {
    const onRetry = jest.fn();
    render(
      <SeriesSelectionStep
        {...base}
        error="load failed"
        onRetry={onRetry}
      />
    );
    expect(screen.getByText('Failed to Load Series')).toBeTruthy();
    fireEvent.click(screen.getByText('Try Again'));
    expect(onRetry).toHaveBeenCalled();
  });

  it('renders the loading skeleton', () => {
    render(
      <SeriesSelectionStep
        {...base}
        isLoading
      />
    );
    expect(screen.getByText('Waiting for DICOM data...')).toBeTruthy();
  });

  it('renders the empty state when there are no series', () => {
    render(
      <SeriesSelectionStep
        {...base}
        series={[]}
        selectedSeriesUIDs={new Set()}
      />
    );
    expect(screen.getByText('No Series Available')).toBeTruthy();
  });

  it('renders the SeriesSelector with the list and enables Next', () => {
    render(<SeriesSelectionStep {...base} />);
    expect(screen.getByText('T1')).toBeTruthy();
    expect(screen.getByText(/Next/).closest('button')!.disabled).toBe(false);
  });

  it('disables Next when nothing is selected', () => {
    render(
      <SeriesSelectionStep
        {...base}
        selectedSeriesUIDs={new Set()}
      />
    );
    expect(screen.getByText(/Next/).closest('button')!.disabled).toBe(true);
  });

  it('disables Next while loading even with series selected', () => {
    render(
      <SeriesSelectionStep
        {...base}
        isLoading
        selectedSeriesUIDs={new Set(['s1'])}
      />
    );
    expect(screen.getByText(/Next/).closest('button')!.disabled).toBe(true);
  });

  it('renders a Back button only when onBack is provided', () => {
    const { rerender } = render(<SeriesSelectionStep {...base} />);
    expect(screen.queryByText(/Back/)).toBeNull();
    rerender(
      <SeriesSelectionStep
        {...base}
        onBack={() => {}}
      />
    );
    expect(screen.getByText(/Back/)).toBeTruthy();
  });
});
