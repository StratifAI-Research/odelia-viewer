import React from 'react';
import { installConsoleErrorFilter } from '../test-utils/harness';
import { render, screen, fireEvent } from '@testing-library/react';
import HeatmapToggle from './HeatmapToggle';

// Swallow only the testing-library/React ReactDOMTestUtils.act deprecation
// (environmental, fires on the first render), re-emit anything else.
installConsoleErrorFilter();

describe('HeatmapToggle', () => {
  it('fires onToggle on click when enabled', () => {
    const onToggle = jest.fn();
    render(
      <HeatmapToggle
        isActive={false}
        onToggle={onToggle}
      />
    );
    fireEvent.click(screen.getByRole('button'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('reflects active state in the title', () => {
    const { rerender } = render(
      <HeatmapToggle
        isActive={false}
        onToggle={jest.fn()}
      />
    );
    expect(screen.getByRole('button').getAttribute('title')).toBe('Show Heatmap');
    rerender(
      <HeatmapToggle
        isActive={true}
        onToggle={jest.fn()}
      />
    );
    expect(screen.getByRole('button').getAttribute('title')).toBe('Hide Heatmap');
  });

  it('does not fire onToggle when disabled and marks the button disabled', () => {
    const onToggle = jest.fn();
    render(
      <HeatmapToggle
        isActive={false}
        disabled
        onToggle={onToggle}
      />
    );
    const btn = screen.getByRole('button') as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(btn.getAttribute('title')).toBe('No heatmap available');
    fireEvent.click(btn);
    expect(onToggle).not.toHaveBeenCalled();
  });

  it('applies an extra className', () => {
    render(
      <HeatmapToggle
        isActive={false}
        onToggle={jest.fn()}
        className="extra-cls"
      />
    );
    expect(screen.getByRole('button').className).toContain('extra-cls');
  });
});
