import React from 'react';
import { render, screen } from '@testing-library/react';
import AIResultInfo from './AIResultInfo';

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

describe('AIResultInfo', () => {
  it('shows the default model name when no modelInfo is given', () => {
    render(<AIResultInfo isClassification={false} />);
    expect(screen.getByText('AI Model')).toBeTruthy();
  });

  it('prefers algorithmName + version over name', () => {
    render(
      <AIResultInfo
        isClassification={false}
        modelInfo={{ name: 'fallback', algorithmName: 'BreastNet', algorithmVersion: '2.1' }}
      />
    );
    expect(screen.getByText('BreastNet v2.1')).toBeTruthy();
  });

  it('uses algorithmName alone when version is missing', () => {
    render(
      <AIResultInfo
        isClassification={false}
        modelInfo={{ name: 'fallback', algorithmName: 'BreastNet', algorithmVersion: null }}
      />
    );
    expect(screen.getByText('BreastNet')).toBeTruthy();
  });

  it('falls back to name when no algorithm info', () => {
    render(<AIResultInfo isClassification={false} modelInfo={{ name: 'Plain Model' }} />);
    expect(screen.getByText('Plain Model')).toBeTruthy();
  });

  it('renders the classification preview when isClassification and data present', () => {
    render(
      <AIResultInfo
        isClassification
        classifications={[
          { concept: 'left', result: 'Malignant', confidence: 87.25 },
          { concept: 'right', result: 'Benign', confidence: null },
        ]}
      />
    );
    expect(screen.getByText('Result')).toBeTruthy();
    // 87.25 -> toFixed(1) -> 87.3; null confidence -> no parens
    expect(screen.getByText('Malignant (87.3%), Benign')).toBeTruthy();
  });

  it('omits the preview block when not a classification', () => {
    render(
      <AIResultInfo
        isClassification={false}
        classifications={[{ concept: 'left', result: 'Malignant', confidence: 50 }]}
      />
    );
    expect(screen.queryByText('Result')).toBeNull();
  });

  it('omits the preview block when classifications are empty', () => {
    render(<AIResultInfo isClassification classifications={[]} />);
    expect(screen.queryByText('Result')).toBeNull();
  });
});
