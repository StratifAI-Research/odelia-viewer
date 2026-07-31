import React from 'react';
import { render, screen } from '@testing-library/react';
import getCustomizationModule from './getCustomizationModule';
import extension from './index';
import { useAIViewportStore } from './stores/useAIViewportStore';
import type { AIResult } from './types';

const aiResult = {
  studyInstanceUID: 's1',
  hasHeatmap: false,
  modelInfo: { name: 'ODELIA-Net' },
  classifications: [{ side: 'Left', result: 'Benign', confidence: 50 }],
} as AIResult;

const overlay = () =>
  getCustomizationModule().find(entry => entry.name === 'aiViewportOverlay')!.value;

describe('view-ai-result customization module', () => {
  beforeEach(() => useAIViewportStore.setState({ viewports: {} }));

  it('is not named `default` or `global`, which OHIF would apply to every mode', () => {
    const names = getCustomizationModule().map(entry => entry.name);
    expect(names).not.toContain('default');
    expect(names).not.toContain('global');
  });

  it('is exposed by the extension so a mode can reference it by name', () => {
    expect(extension.getCustomizationModule).toBe(getCustomizationModule);
  });

  it('renders the AI summary for the viewport OHIF passes to contentF', () => {
    useAIViewportStore.setState({
      viewports: {
        v1: { aiResult, hasHeatmap: false, isHeatmapActive: false, onToggleHeatmap: null },
      },
    });

    const [item] = overlay()['viewportOverlay.topLeft'];
    render(<>{item.contentF({ viewportId: 'v1' })}</>);

    expect(screen.getByText('🤖 ODELIA-Net')).toBeTruthy();
  });

  it('empties the other three corners so the AI summary stands alone', () => {
    expect(overlay()['viewportOverlay.topRight']).toEqual([]);
    expect(overlay()['viewportOverlay.bottomLeft']).toEqual([]);
    expect(overlay()['viewportOverlay.bottomRight']).toEqual([]);
  });
});
