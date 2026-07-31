import React from 'react';
import { render, screen } from '@testing-library/react';
import AIResultOverlay from './AIResultOverlay';
import { useAIViewportStore, ViewportAIState } from '../stores/useAIViewportStore';
import type { AIResult } from '../types';

const publish = (viewportId: string, state: Partial<ViewportAIState>) =>
  useAIViewportStore.setState({
    viewports: {
      [viewportId]: {
        aiResult: null,
        hasHeatmap: false,
        isHeatmapActive: false,
        onToggleHeatmap: null,
        ...state,
      },
    },
  });

const result = (over: Partial<AIResult> = {}) =>
  ({
    studyInstanceUID: 's1',
    hasHeatmap: false,
    modelInfo: { name: 'ODELIA-Net' },
    classifications: [
      { side: 'Left', result: 'Benign', confidence: 12.34 },
      { side: 'Right', result: 'Malignant', confidence: 88.76 },
    ],
    ...over,
  }) as AIResult;

describe('AIResultOverlay', () => {
  beforeEach(() => useAIViewportStore.setState({ viewports: {} }));

  it('renders nothing for a viewport that published no state', () => {
    const { container } = render(<AIResultOverlay viewportId="v1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing for a viewport whose state carries no AI result', () => {
    publish('v1', {});
    const { container } = render(<AIResultOverlay viewportId="v1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders the model name and both classifications', () => {
    publish('v1', { aiResult: result() });
    render(<AIResultOverlay viewportId="v1" />);
    expect(screen.getByText('🤖 ODELIA-Net')).toBeTruthy();
    expect(screen.getByText('Left Breast: Benign (12.3%)')).toBeTruthy();
    expect(screen.getByText('Right Breast: Malignant (88.8%)')).toBeTruthy();
  });

  it('shows a per-side error message instead of a score', () => {
    publish('v1', {
      aiResult: result({
        classifications: [
          { side: 'Left', result: null, confidence: null, errorMessage: 'Series missing' },
        ],
      }),
    });
    render(<AIResultOverlay viewportId="v1" />);
    expect(screen.getByText('Left Breast: Series missing')).toBeTruthy();
    // the side the model said nothing about is still shown, as unknown
    expect(screen.getByText('Right Breast: --')).toBeTruthy();
  });

  it('only reads the state of its own viewport', () => {
    publish('other', { aiResult: result() });
    const { container } = render(<AIResultOverlay viewportId="v1" />);
    expect(container.firstChild).toBeNull();
  });
});
