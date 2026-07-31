import React from 'react';
import { render, screen } from '@testing-library/react';
import extension from './index';
import { useAIViewportStore } from './stores/useAIViewportStore';
import type { AIResult } from './types';

const aiResult = { studyInstanceUID: 's1', hasHeatmap: true, classifications: [] } as AIResult;

const toolbarModule = () =>
  extension.getToolbarModule({
    servicesManager: { services: {} },
  } as any);

const heatmapToggleComponent = () => {
  const entry = toolbarModule().find(m => m.name === 'viewAIResult.heatmapToggle');
  return entry?.defaultComponent as React.ComponentType<{ viewportId?: string }>;
};

describe('view-ai-result toolbar module', () => {
  beforeEach(() => useAIViewportStore.setState({ viewports: {} }));

  // The counterpart of this name is `uiType: 'viewAIResult.heatmapToggle'` in
  // custom/mode/send-ai/src/toolbarButtons.ts. OHIF resolves the ui type at
  // render time and throws if it is unknown, so the two must stay in step.
  it('provides the `viewAIResult.heatmapToggle` ui type', () => {
    const entry = toolbarModule().find(m => m.name === 'viewAIResult.heatmapToggle');
    expect(entry?.defaultComponent).toBeTruthy();
  });

  it('renders the heatmap toggle for the viewport the toolbar names', () => {
    useAIViewportStore.setState({
      viewports: {
        'vp-1': { aiResult, hasHeatmap: true, isHeatmapActive: false, onToggleHeatmap: jest.fn() },
      },
    });

    const Component = heatmapToggleComponent();
    render(<Component viewportId="vp-1" />);

    expect(screen.getByText('🔥 Heatmap Available')).toBeTruthy();
  });

  it('renders nothing in viewports that have no AI result', () => {
    const Component = heatmapToggleComponent();
    const { container } = render(<Component viewportId="vp-1" />);
    expect(container.firstChild).toBeNull();
  });
});
