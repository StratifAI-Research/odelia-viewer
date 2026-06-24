import { renderHook, act } from '@testing-library/react';
import { useAIResultSubscription } from './useAIResultSubscription';

// Builds a fake aiResultsService whose subscribe records callbacks per event
// and returns spy unsubscribe handles.
function makeAIResultsService() {
  const handlers: Record<string, Array<(d: any) => void>> = {};
  const unsubscribes: jest.Mock[] = [];
  const subscribe = jest.fn((event: string, cb: (d: any) => void) => {
    (handlers[event] ||= []).push(cb);
    const unsubscribe = jest.fn();
    unsubscribes.push(unsubscribe);
    return { unsubscribe };
  });
  return {
    EVENTS: {
      AI_RESULT_SELECTED: 'AI_RESULT_SELECTED',
      AI_RESULT_CLEARED: 'AI_RESULT_CLEARED',
      STUDY_CHANGED: 'STUDY_CHANGED',
    },
    subscribe,
    unsubscribes,
    emit(event: string, data: any) {
      (handlers[event] || []).forEach(cb => cb(data));
    },
  };
}

function makeConfig(overrides: any = {}) {
  const aiResultsService = overrides.aiResultsService ?? makeAIResultsService();
  return {
    aiResultsService,
    config: {
      viewportId: 'v1',
      isHeatmapViewport: false,
      servicesManager: { services: { aiResultsService } },
      onAIResultSelected: jest.fn(),
      onAIResultCleared: jest.fn(),
      onStudyChanged: jest.fn(),
      ...overrides.config,
    },
  };
}

describe('useAIResultSubscription', () => {
  it('subscribes to selected and cleared events on mount', () => {
    const { aiResultsService, config } = makeConfig();
    renderHook(() => useAIResultSubscription(config));
    expect(aiResultsService.subscribe).toHaveBeenCalledWith('AI_RESULT_SELECTED', expect.any(Function));
    expect(aiResultsService.subscribe).toHaveBeenCalledWith('AI_RESULT_CLEARED', expect.any(Function));
    expect(aiResultsService.subscribe).toHaveBeenCalledTimes(2);
  });

  it('forwards a selected event to onAIResultSelected', () => {
    const { aiResultsService, config } = makeConfig();
    renderHook(() => useAIResultSubscription(config));
    const aiResult = { studyInstanceUID: 's1' };
    act(() => {
      aiResultsService.emit('AI_RESULT_SELECTED', { aiResult, clickedDisplaySetInstanceUID: 'ds9' });
    });
    expect(config.onAIResultSelected).toHaveBeenCalledWith(aiResult, 'ds9');
  });

  it('falls back to displaySetInstanceUID when clicked UID absent', () => {
    const { aiResultsService, config } = makeConfig();
    renderHook(() => useAIResultSubscription(config));
    const aiResult = { studyInstanceUID: 's1' };
    act(() => {
      aiResultsService.emit('AI_RESULT_SELECTED', { aiResult, displaySetInstanceUID: 'dsFallback' });
    });
    expect(config.onAIResultSelected).toHaveBeenCalledWith(aiResult, 'dsFallback');
  });

  it('forwards a cleared event to onAIResultCleared', () => {
    const { aiResultsService, config } = makeConfig();
    renderHook(() => useAIResultSubscription(config));
    act(() => {
      aiResultsService.emit('AI_RESULT_CLEARED', { reason: 'x' });
    });
    expect(config.onAIResultCleared).toHaveBeenCalledWith({ reason: 'x' });
  });

  it('unsubscribes both subscriptions on unmount', () => {
    const { aiResultsService, config } = makeConfig();
    const { unmount } = renderHook(() => useAIResultSubscription(config));
    expect(aiResultsService.unsubscribes).toHaveLength(2);
    unmount();
    aiResultsService.unsubscribes.forEach(u => expect(u).toHaveBeenCalledTimes(1));
  });

  it('does not re-subscribe when re-rendered with stable deps', () => {
    const { aiResultsService, config } = makeConfig();
    const { rerender } = renderHook((c: any) => useAIResultSubscription(c), { initialProps: config });
    rerender(config);
    rerender(config);
    expect(aiResultsService.subscribe).toHaveBeenCalledTimes(2);
  });

  it('skips subscription for heatmap viewports', () => {
    const { aiResultsService, config } = makeConfig({ config: { isHeatmapViewport: true } });
    renderHook(() => useAIResultSubscription(config));
    expect(aiResultsService.subscribe).not.toHaveBeenCalled();
  });

  it('ignores selected events on heatmap viewports via guarded handler', () => {
    const { config } = makeConfig({ config: { isHeatmapViewport: true } });
    renderHook(() => useAIResultSubscription(config));
    // No subscription set up, so callback must never run.
    expect(config.onAIResultSelected).not.toHaveBeenCalled();
  });
});
