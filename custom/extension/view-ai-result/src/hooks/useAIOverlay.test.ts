import { renderHook } from '@testing-library/react';
import { useAIOverlay } from './useAIOverlay';
import { useAIViewportStore } from '../stores/useAIViewportStore';
import type { AIResult } from '../types';

const sampleResult = {
  studyInstanceUID: 'study-1',
  hasHeatmap: true,
  modelInfo: { name: 'TestModel' },
  classifications: [
    { side: 'Left', result: 'Benign', confidence: 12.3 },
    { side: 'Right', result: 'Malignant', confidence: 88.7 },
  ],
} as AIResult;

function makeConfig(overrides: any = {}) {
  return {
    viewportId: 'v1',
    aiResult: null,
    isHeatmapViewport: false,
    ...overrides,
  };
}

const stateOf = (viewportId: string) => useAIViewportStore.getState().viewports[viewportId];

describe('useAIOverlay', () => {
  beforeEach(() => {
    useAIViewportStore.setState({ viewports: {} });
  });

  it('publishes an empty state for a viewport with no AI result', () => {
    renderHook(() => useAIOverlay(makeConfig()));
    expect(stateOf('v1')).toEqual({
      aiResult: null,
      hasHeatmap: false,
      isHeatmapActive: false,
      onToggleHeatmap: null,
    });
  });

  it('publishes the AI result and its heatmap availability', () => {
    const onToggleHeatmap = jest.fn();
    renderHook(() =>
      useAIOverlay(makeConfig({ aiResult: sampleResult, isHeatmapActive: true, onToggleHeatmap }))
    );
    expect(stateOf('v1')).toEqual({
      aiResult: sampleResult,
      hasHeatmap: true,
      isHeatmapActive: true,
      onToggleHeatmap,
    });
  });

  it('reports no heatmap when the result carries none', () => {
    const aiResult = { ...sampleResult, hasHeatmap: false };
    renderHook(() => useAIOverlay(makeConfig({ aiResult })));
    expect(stateOf('v1').hasHeatmap).toBe(false);
  });

  it('republishes when the AI result changes', () => {
    const { rerender } = renderHook((c: any) => useAIOverlay(c), {
      initialProps: makeConfig(),
    });
    expect(stateOf('v1').aiResult).toBeNull();
    rerender(makeConfig({ aiResult: sampleResult }));
    expect(stateOf('v1').aiResult).toBe(sampleResult);
  });

  it('keeps the same state object when nothing changed, so consumers do not re-render', () => {
    const config = makeConfig({ aiResult: sampleResult });
    const { rerender } = renderHook((c: any) => useAIOverlay(c), { initialProps: config });
    const first = stateOf('v1');
    rerender({ ...config });
    expect(stateOf('v1')).toBe(first);
  });

  it('publishes nothing for a heatmap viewport', () => {
    renderHook(() =>
      useAIOverlay(makeConfig({ isHeatmapViewport: true, aiResult: sampleResult }))
    );
    expect(stateOf('v1')).toBeUndefined();
  });

  it('drops the viewport entry on unmount', () => {
    const { unmount } = renderHook(() => useAIOverlay(makeConfig({ aiResult: sampleResult })));
    expect(stateOf('v1')).toBeDefined();
    unmount();
    expect(stateOf('v1')).toBeUndefined();
  });
});
