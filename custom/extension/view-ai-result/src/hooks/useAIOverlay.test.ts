import { renderHook, act } from '@testing-library/react';
import { useAIOverlay } from './useAIOverlay';

const LOCATIONS = { topLeft: 'topLeft', topRight: 'topRight' };

function makeServices() {
  return {
    viewportActionCornersService: {
      addComponent: jest.fn(),
      LOCATIONS,
    },
    customizationService: {
      setCustomizations: jest.fn(),
    },
  };
}

function makeConfig(overrides: any = {}) {
  const services = overrides.services ?? makeServices();
  return {
    services,
    config: {
      viewportId: 'v1',
      aiResult: null,
      isHeatmapViewport: false,
      servicesManager: { services },
      ...overrides.config,
    },
  };
}

const sampleResult = {
  modelInfo: { name: 'TestModel' },
  classifications: [
    { side: 'Left', result: 'Benign', confidence: 12.3 },
    { side: 'Right', result: 'Malignant', confidence: 88.7 },
  ],
};

function addCalls(svc: any, id: string) {
  return svc.viewportActionCornersService.addComponent.mock.calls
    .map((c: any[]) => c[0])
    .filter((a: any) => a.id === id);
}

describe('useAIOverlay', () => {
  it('returns the overlay control API', () => {
    const { config } = makeConfig();
    const { result } = renderHook(() => useAIOverlay(config));
    expect(typeof result.current.updateOverlay).toBe('function');
    expect(typeof result.current.clearOverlay).toBe('function');
    expect(typeof result.current.setupHeatmapActionCorner).toBe('function');
    expect(typeof result.current.clearActionCorners).toBe('function');
  });

  it('clears the overlay on mount when no AI result is present', () => {
    const { services, config } = makeConfig();
    renderHook(() => useAIOverlay(config));
    const overlayCalls = addCalls(services, 'aiOverlay');
    expect(overlayCalls.length).toBeGreaterThan(0);
    expect(overlayCalls[overlayCalls.length - 1].component).toBeNull();
  });

  it('adds an overlay component when an AI result is present', () => {
    const { services, config } = makeConfig({ config: { aiResult: sampleResult } });
    renderHook(() => useAIOverlay(config));
    expect(services.customizationService.setCustomizations).toHaveBeenCalled();
    const overlayCalls = addCalls(services, 'aiOverlay');
    const added = overlayCalls.find((a: any) => a.component !== null);
    expect(added).toBeTruthy();
    expect(added.location).toBe(LOCATIONS.topLeft);
  });

  it('updates the overlay when aiResult changes from null to a result', () => {
    const { services, config } = makeConfig();
    const { rerender } = renderHook((c: any) => useAIOverlay(c), { initialProps: config });
    services.customizationService.setCustomizations.mockClear();
    rerender({ ...config, aiResult: sampleResult });
    expect(services.customizationService.setCustomizations).toHaveBeenCalled();
  });

  it('clears the overlay container on unmount for primary viewports', () => {
    const { services, config } = makeConfig({ config: { aiResult: sampleResult } });
    const { unmount } = renderHook(() => useAIOverlay(config));
    const before = addCalls(services, 'aiOverlay').length;
    unmount();
    const after = addCalls(services, 'aiOverlay');
    expect(after.length).toBeGreaterThan(before);
    expect(after[after.length - 1].component).toBeNull();
  });

  it('blocks overlays for heatmap viewports', () => {
    const { services, config } = makeConfig({ config: { isHeatmapViewport: true, aiResult: sampleResult } });
    renderHook(() => useAIOverlay(config));
    expect(services.customizationService.setCustomizations).not.toHaveBeenCalled();
    const overlayCalls = addCalls(services, 'aiOverlay');
    // Heatmap branch only ever clears (null component).
    overlayCalls.forEach((a: any) => expect(a.component).toBeNull());
  });

  it('setupHeatmapActionCorner registers a top-right toggle component', () => {
    const { services, config } = makeConfig();
    const { result } = renderHook(() => useAIOverlay(config));
    act(() => {
      // sampleResult is a deliberately minimal fixture; cast for this typed call.
      result.current.setupHeatmapActionCorner(sampleResult as any, jest.fn(), false, true);
    });
    const toggleCalls = addCalls(services, 'heatmapToggle');
    const added = toggleCalls.find((a: any) => a.component !== null);
    expect(added).toBeTruthy();
    expect(added.location).toBe(LOCATIONS.topRight);
  });
});
