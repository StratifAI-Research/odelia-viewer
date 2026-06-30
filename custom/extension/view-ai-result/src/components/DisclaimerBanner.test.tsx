import React from 'react';
import { installConsoleErrorFilter } from '../test-utils/harness';
import { render, screen, fireEvent } from '@testing-library/react';
import DisclaimerBanner from './DisclaimerBanner';

const STORAGE_KEY = 'odeliaDisclaimerHidden';

// Swallow only the testing-library/React ReactDOMTestUtils.act deprecation
// (environmental, fires on effect-driven first renders), re-emit anything else.
installConsoleErrorFilter();

describe('DisclaimerBanner', () => {
  let openSpy: jest.SpyInstance;
  beforeEach(() => {
    sessionStorage.clear();
    openSpy = jest.spyOn(window, 'open').mockImplementation(() => null as any);
  });

  afterEach(() => {
    openSpy.mockRestore();
  });

  it('renders the banner when not previously dismissed', () => {
    render(<DisclaimerBanner />);
    expect(screen.getByRole('button', { name: 'Confirm and Hide' })).toBeTruthy();
  });

  it('stays hidden when sessionStorage already marks it dismissed', () => {
    sessionStorage.setItem(STORAGE_KEY, 'true');
    const { container } = render(<DisclaimerBanner />);
    expect(container.querySelector('button')).toBeNull();
  });

  it('dismisses, persists the flag, and unmounts the banner on confirm', () => {
    render(<DisclaimerBanner />);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm and Hide' }));
    expect(sessionStorage.getItem(STORAGE_KEY)).toBe('true');
    expect(screen.queryByRole('button', { name: 'Confirm and Hide' })).toBeNull();
  });

  it('opens the model limitations link in a new tab', () => {
    render(<DisclaimerBanner />);
    fireEvent.click(screen.getByText('See model limitations'));
    expect(window.open).toHaveBeenCalledWith(
      'https://github.com/StratifAI-Research/odelia-deployment/blob/main/docs/model_limitations.md',
      '_blank'
    );
  });

  it('opens the project link in a new tab', () => {
    render(<DisclaimerBanner />);
    fireEvent.click(screen.getByText('Learn more about the ODELIA project'));
    expect(window.open).toHaveBeenCalledWith('https://odelia.ai/', '_blank');
  });
});
