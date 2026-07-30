import { renderHook } from '@testing-library/react';
import { useStudyChangeDetector } from './useStudyChangeDetector';

function makeConfig(overrides: any = {}) {
  const notifyStudyChange = jest.fn();
  const aiResultsService = overrides.aiResultsService ?? { notifyStudyChange };
  const viewports = overrides.viewports ?? new Map([['v1', { displaySetInstanceUIDs: ['ds1'] }]]);
  const displaySetService = overrides.displaySetService ?? {
    getDisplaySetByUID: jest.fn((uid: string) =>
      uid === 'ds1' ? { StudyInstanceUID: 'studyA' } : { StudyInstanceUID: 'studyB' }
    ),
  };
  const servicesManager = { services: { aiResultsService } };
  return {
    notifyStudyChange,
    displaySetService,
    config: {
      servicesManager,
      viewportGridService: {},
      displaySetService,
      activeViewportId: 'v1',
      viewports,
      StudyInstanceUIDs: ['studyFallback'],
      ...overrides.config,
    },
  };
}

describe('useStudyChangeDetector', () => {
  it('notifies the initial study on mount', () => {
    const { notifyStudyChange, config } = makeConfig();
    const sm = config.servicesManager;
    renderHook(() => useStudyChangeDetector(config));
    expect(notifyStudyChange).toHaveBeenCalledWith('studyA', sm);
  });

  it('does not re-notify on a same-study rerender', () => {
    const { notifyStudyChange, config } = makeConfig();
    const { rerender } = renderHook((c: any) => useStudyChangeDetector(c), {
      initialProps: config,
    });
    const callsAfterMount = notifyStudyChange.mock.calls.length;
    rerender(config);
    rerender(config);
    expect(notifyStudyChange.mock.calls.length).toBe(callsAfterMount);
  });

  it('notifies again only when the active study id changes', () => {
    const { notifyStudyChange, config } = makeConfig();
    const { rerender } = renderHook((c: any) => useStudyChangeDetector(c), {
      initialProps: config,
    });
    notifyStudyChange.mockClear();
    // Point active viewport at a display set that resolves to a different study.
    const nextViewports = new Map([['v1', { displaySetInstanceUIDs: ['dsOther'] }]]);
    rerender({ ...config, viewports: nextViewports });
    expect(notifyStudyChange).toHaveBeenCalledWith('studyB', config.servicesManager);
  });

  it('falls back to first StudyInstanceUID when no active viewport', () => {
    const { notifyStudyChange, config } = makeConfig({ config: { activeViewportId: null } });
    renderHook(() => useStudyChangeDetector(config));
    expect(notifyStudyChange).toHaveBeenCalledWith('studyFallback', config.servicesManager);
  });

  it('does nothing when aiResultsService is absent', () => {
    const { config } = makeConfig({ aiResultsService: undefined });
    config.servicesManager = { services: {} } as any;
    expect(() => renderHook(() => useStudyChangeDetector(config))).not.toThrow();
  });
});
