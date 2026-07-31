import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { SeriesListSkeleton, EmptyState, ErrorState } from './LoadingStates';

describe('LoadingStates', () => {
  it('renders the skeleton placeholders', () => {
    const { container } = render(<SeriesListSkeleton />);
    expect(container.querySelectorAll('.animate-pulse').length).toBe(4);
  });

  it('EmptyState shows the title, message, and a default icon', () => {
    render(
      <EmptyState
        title="Nothing here"
        message="try later"
      />
    );
    expect(screen.getByText('Nothing here')).toBeTruthy();
    expect(screen.getByText('try later')).toBeTruthy();
    expect(screen.getByText('📭')).toBeTruthy();
  });

  it('EmptyState renders a custom icon when provided', () => {
    render(
      <EmptyState
        icon="🔍"
        title="t"
        message="m"
      />
    );
    expect(screen.getByText('🔍')).toBeTruthy();
  });

  it('ErrorState renders a retry button that fires onRetry', () => {
    const onRetry = jest.fn();
    render(
      <ErrorState
        title="Boom"
        message="bad"
        onRetry={onRetry}
      />
    );
    fireEvent.click(screen.getByText('Try Again'));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('ErrorState omits the retry button when onRetry is absent', () => {
    render(
      <ErrorState
        title="Boom"
        message="bad"
      />
    );
    expect(screen.queryByText('Try Again')).toBeNull();
  });
});
