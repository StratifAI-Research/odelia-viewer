import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import SeriesSelector, { SeriesInfo } from './SeriesSelector';

function series(over: Partial<SeriesInfo> = {}): SeriesInfo {
  return {
    displaySetInstanceUID: 'd',
    SeriesInstanceUID: 's1',
    SeriesDescription: 'T1 axial',
    SeriesNumber: 1,
    Modality: 'MR',
    numImageFrames: 10,
    StudyInstanceUID: 'st',
    ...over,
  };
}

const noop = () => {};

describe('SeriesSelector', () => {
  it('shows an empty message when there are no series', () => {
    render(
      <SeriesSelector
        series={[]}
        selectedSeriesUIDs={new Set()}
        onToggleSeries={noop}
        onSelectAll={noop}
        onClearSelection={noop}
      />
    );
    expect(screen.getByText('No series available for this study')).toBeTruthy();
  });

  it('renders each series and a selection summary with total instances', () => {
    const list = [
      series({ SeriesInstanceUID: 's1', SeriesDescription: 'T1', numImageFrames: 10 }),
      series({ SeriesInstanceUID: 's2', SeriesDescription: 'T2', numImageFrames: 5 }),
    ];
    render(
      <SeriesSelector
        series={list}
        selectedSeriesUIDs={new Set(['s1', 's2'])}
        onToggleSeries={noop}
        onSelectAll={noop}
        onClearSelection={noop}
      />
    );
    expect(screen.getByText('T1')).toBeTruthy();
    expect(screen.getByText('T2')).toBeTruthy();
    expect(screen.getByText('2 series (15 instances)')).toBeTruthy();
  });

  it('toggles a series when its row is clicked', () => {
    const onToggleSeries = jest.fn();
    render(
      <SeriesSelector
        series={[series({ SeriesInstanceUID: 's1', SeriesDescription: 'T1' })]}
        selectedSeriesUIDs={new Set()}
        onToggleSeries={onToggleSeries}
        onSelectAll={noop}
        onClearSelection={noop}
      />
    );
    fireEvent.click(screen.getByText('T1'));
    expect(onToggleSeries).toHaveBeenCalledWith('s1');
  });

  it('fires onSelectAll and onClearSelection from the action buttons', () => {
    const onSelectAll = jest.fn();
    const onClearSelection = jest.fn();
    render(
      <SeriesSelector
        series={[series()]}
        selectedSeriesUIDs={new Set()}
        onToggleSeries={noop}
        onSelectAll={onSelectAll}
        onClearSelection={onClearSelection}
      />
    );
    fireEvent.click(screen.getByText('✓ Select All'));
    fireEvent.click(screen.getByText('Clear'));
    expect(onSelectAll).toHaveBeenCalledTimes(1);
    expect(onClearSelection).toHaveBeenCalledTimes(1);
  });

  it('falls back to a series-number label when description is empty', () => {
    render(
      <SeriesSelector
        series={[series({ SeriesDescription: '', SeriesNumber: 7 })]}
        selectedSeriesUIDs={new Set()}
        onToggleSeries={noop}
        onSelectAll={noop}
        onClearSelection={noop}
      />
    );
    expect(screen.getByText('Series 7')).toBeTruthy();
  });
});
