import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { ProgressStep } from './ProgressStep';

const Bar = ({ progress }: { progress: number }) => <div data-testid="bar">{progress}</div>;

const base = {
  status: 'idle' as const,
  progress: 0,
  onReset: () => {},
  ProgressLoadingBar: Bar,
};

describe('ProgressStep', () => {
  it('shows the error and hides the progress UI when error is set', () => {
    render(<ProgressStep {...base} status="checking" progress={50} error="failed" />);
    expect(screen.getByText('failed')).toBeTruthy();
    expect(screen.queryByTestId('bar')).toBeNull();
  });

  it('renders the routing title and the injected progress bar', () => {
    render(<ProgressStep {...base} status="routing" progress={20} />);
    expect(screen.getByText('Sending to AI...')).toBeTruthy();
    expect(screen.getByTestId('bar').textContent).toBe('20');
    expect(screen.getByText('20%')).toBeTruthy();
  });

  it('prefers the progressDescription over the default message', () => {
    render(<ProgressStep {...base} status="checking" progress={40} progressDescription="halfway" />);
    expect(screen.getByText('halfway')).toBeTruthy();
  });

  it('shows the complete title when idle at 100%', () => {
    render(<ProgressStep {...base} status="idle" progress={100} />);
    expect(screen.getByText('✅ Complete!')).toBeTruthy();
  });

  it('shows a reset button when idle or errored and fires onReset', () => {
    const onReset = jest.fn();
    render(<ProgressStep {...base} status="idle" progress={100} onReset={onReset} />);
    fireEvent.click(screen.getByText(/Start New Analysis/));
    expect(onReset).toHaveBeenCalledTimes(1);
  });

  it('hides the reset button while routing', () => {
    render(<ProgressStep {...base} status="routing" progress={10} />);
    expect(screen.queryByText(/Start New Analysis/)).toBeNull();
  });

  it('shows the refreshing title and default message', () => {
    render(<ProgressStep {...base} status="refreshing" progress={60} />);
    expect(screen.getByText('Loading Results...')).toBeTruthy();
    expect(screen.getByText('Fetching AI results...')).toBeTruthy();
  });

  it('shows no status message when idle at 0%', () => {
    render(<ProgressStep {...base} status="idle" progress={0} />);
    expect(screen.queryByText(/Uploading series/)).toBeNull();
    expect(screen.queryByText(/Fetching AI results/)).toBeNull();
  });

  it('shows the reset button when errored even if not idle', () => {
    const onReset = jest.fn();
    render(<ProgressStep {...base} status="checking" error="bang" onReset={onReset} />);
    fireEvent.click(screen.getByText(/Start New Analysis/));
    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
