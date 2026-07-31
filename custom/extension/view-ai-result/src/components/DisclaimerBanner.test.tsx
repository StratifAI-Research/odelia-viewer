import React from 'react';
import { installConsoleErrorFilter } from '../test-utils/harness';
import { render, screen, fireEvent } from '@testing-library/react';
import DisclaimerBanner from './DisclaimerBanner';

const STORAGE_KEY = 'odeliaDisclaimerHidden';

// Swallow only the testing-library/React ReactDOMTestUtils.act deprecation
// (environmental, fires on effect-driven first renders), re-emit anything else.
installConsoleErrorFilter();

describe('DisclaimerBanner', () => {
  beforeEach(() => {
    sessionStorage.clear();
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

  // Real anchors rather than window.open: they are keyboard-reachable and
  // middle-clickable, and `rel` is what keeps the opened tab from reaching back
  // through window.opener.
  it.each([
    [
      'See model limitations',
      'https://github.com/StratifAI-Research/odelia-deployment/blob/main/docs/model_limitations.md',
    ],
    ['Learn more about the ODELIA project', 'https://odelia.ai/'],
  ])('links %s out to a new tab', (text, href) => {
    render(<DisclaimerBanner />);
    const link = screen.getByText(text) as HTMLAnchorElement;
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe(href);
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
  });
});
