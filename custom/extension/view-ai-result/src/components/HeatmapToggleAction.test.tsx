import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import HeatmapToggleAction from './HeatmapToggleAction';
import { useAIViewportStore, ViewportAIState } from '../stores/useAIViewportStore';
import type { AIResult } from '../types';

const aiResult = { studyInstanceUID: 's1', hasHeatmap: true, classifications: [] } as AIResult;

const publish = (viewportId: string, state: Partial<ViewportAIState>) =>
  useAIViewportStore.setState({
    viewports: {
      [viewportId]: {
        aiResult,
        hasHeatmap: true,
        isHeatmapActive: false,
        onToggleHeatmap: null,
        ...state,
      },
    },
  });

const button = () => screen.getByRole('button');
// ToolButton stamps the tool state onto the tooltip trigger, not the button.
const state = (attr: string) => screen.getByTestId('ai-heatmap-toggle').getAttribute(attr);

describe('HeatmapToggleAction', () => {
  beforeEach(() => useAIViewportStore.setState({ viewports: {} }));

  it('renders nothing until its viewport publishes an AI result', () => {
    const { container } = render(<HeatmapToggleAction viewportId="v1" />);
    expect(container.firstChild).toBeNull();
  });

  it('renders nothing when the toolbar gives it no viewport id', () => {
    publish('v1', {});
    const { container } = render(<HeatmapToggleAction />);
    expect(container.firstChild).toBeNull();
  });

  it('offers the heatmap when one is available', () => {
    publish('v1', { onToggleHeatmap: jest.fn() });
    render(<HeatmapToggleAction viewportId="v1" />);
    expect((button() as HTMLButtonElement).disabled).toBe(false);
    expect(state('data-toggled')).toBe('false');
  });

  it('reports the heatmap as on while it is open', () => {
    publish('v1', { isHeatmapActive: true, onToggleHeatmap: jest.fn() });
    render(<HeatmapToggleAction viewportId="v1" />);
    expect(state('data-toggled')).toBe('true');
  });

  it('disables itself when the result carries no heatmap', () => {
    const onToggleHeatmap = jest.fn();
    publish('v1', { hasHeatmap: false, onToggleHeatmap });
    render(<HeatmapToggleAction viewportId="v1" />);
    expect((button() as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(button());
    expect(onToggleHeatmap).not.toHaveBeenCalled();
  });

  it('toggles exactly once per click', () => {
    const onToggleHeatmap = jest.fn();
    publish('v1', { onToggleHeatmap });
    render(<HeatmapToggleAction viewportId="v1" />);
    fireEvent.click(button());
    expect(onToggleHeatmap).toHaveBeenCalledTimes(1);
  });
});
