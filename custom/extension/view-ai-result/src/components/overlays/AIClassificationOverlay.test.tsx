import React from 'react';
import { render, screen } from '@testing-library/react';
import AIClassificationOverlay from './AIClassificationOverlay';

// Swallow only the testing-library/React ReactDOMTestUtils.act deprecation
// (environmental, fires on the first render), re-emit anything else.
const realError = console.error;
beforeAll(() => {
  jest.spyOn(console, 'error').mockImplementation((...args: any[]) => {
    if (typeof args[0] === 'string' && args[0].includes('ReactDOMTestUtils.act')) {
      return;
    }
    realError(...args);
  });
});
afterAll(() => (console.error as jest.Mock).mockRestore());

describe('AIClassificationOverlay', () => {
  it('renders nothing when aiResult has no classifications', () => {
    const { container } = render(<AIClassificationOverlay aiResult={{} as any} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders both breast classifications with result and confidence', () => {
    render(
      <AIClassificationOverlay
        aiResult={
          {
            modelInfo: { name: 'BreastNet' },
            classifications: [
              { side: 'Left', result: 'Malignant', confidence: 91.27 },
              { side: 'Right', result: 'Benign', confidence: 12.3 },
            ],
          } as any
        }
      />
    );
    expect(screen.getByText('Left Breast:')).toBeTruthy();
    expect(screen.getByText('Right Breast:')).toBeTruthy();
    expect(screen.getByText('Malignant')).toBeTruthy();
    expect(screen.getByText('Benign')).toBeTruthy();
    expect(screen.getByText('(91.3%)')).toBeTruthy();
    expect(screen.getByText('(12.3%)')).toBeTruthy();
    expect(screen.getByText(/BreastNet/)).toBeTruthy();
  });

  it('shows "No data" for a side that has no result', () => {
    render(
      <AIClassificationOverlay
        aiResult={
          {
            classifications: [{ side: 'Left', result: 'Benign', confidence: 5 }],
          } as any
        }
      />
    );
    // Right breast has no entry -> falls into "No data" branch
    expect(screen.getByText('No data')).toBeTruthy();
  });

  it('shows N/A when a result is present but confidence is missing', () => {
    render(
      <AIClassificationOverlay
        aiResult={
          {
            classifications: [{ side: 'Left', result: 'No lesion', confidence: null }],
          } as any
        }
      />
    );
    expect(screen.getByText('No lesion')).toBeTruthy();
    expect(screen.getByText('(N/A%)')).toBeTruthy();
  });

  it('falls back to "AI Model" when modelInfo is absent', () => {
    render(
      <AIClassificationOverlay
        aiResult={{ classifications: [{ side: 'Left', result: 'Benign', confidence: 1 }] } as any}
      />
    );
    expect(screen.getByText(/AI Model/)).toBeTruthy();
  });
});
