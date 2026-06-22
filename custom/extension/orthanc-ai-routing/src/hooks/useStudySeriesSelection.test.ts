import { renderHook, act } from '@testing-library/react';

jest.mock('@ohif/core', () => ({
  utils: { formatDate: (d: string) => d || '' },
  DicomMetadataStore: { getStudy: jest.fn(() => ({ series: [] })) },
}));

import { useStudySeriesSelection } from './useStudySeriesSelection';

function makeDSS(displaySets: any[]) {
  const listeners: Record<string, Function[]> = {};
  const unsubs: jest.Mock[] = [];
  return {
    EVENTS: { DISPLAY_SETS_CHANGED: 'changed' },
    getActiveDisplaySets: jest.fn(() => displaySets),
    subscribe: jest.fn((evt: string, cb: Function) => {
      (listeners[evt] ||= []).push(cb);
      const unsubscribe = jest.fn();
      unsubs.push(unsubscribe);
      return { unsubscribe };
    }),
    _unsubs: unsubs,
  };
}

function ds(over: Record<string, any> = {}) {
  return {
    StudyInstanceUID: 'st1',
    Modality: 'MR',
    displaySetInstanceUID: 'd1',
    SeriesInstanceUID: 's1',
    SeriesDescription: 'T1',
    SeriesNumber: 1,
    numImageFrames: 10,
    StudyDescription: 'Brain',
    StudyDate: '20240101',
    ...over,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('useStudySeriesSelection — studies', () => {
  it('groups studies after the load delay, skipping SR/SC display sets', async () => {
    const dss = makeDSS([
      ds({ SeriesInstanceUID: 's1', Modality: 'MR' }),
      ds({ SeriesInstanceUID: 's2', Modality: 'SR', displaySetInstanceUID: 'd2' }), // skipped
    ]);
    const { result } = renderHook(() =>
      useStudySeriesSelection({ displaySetService: dss as any, activeStudyUID: null })
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(150);
    });
    expect(result.current.availableStudies).toHaveLength(1);
    expect(result.current.availableStudies[0].studyInstanceUid).toBe('st1');
    expect(result.current.isLoadingStudies).toBe(false);
  });

  it('handles an empty display-set list without error', async () => {
    const dss = makeDSS([]);
    const { result } = renderHook(() =>
      useStudySeriesSelection({ displaySetService: dss as any, activeStudyUID: null })
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(150);
    });
    expect(result.current.availableStudies).toEqual([]);
    expect(result.current.isLoadingStudies).toBe(false);
  });
});

describe('useStudySeriesSelection — series', () => {
  it('loads series for the active study and auto-selects them all (excluding SR/SC)', async () => {
    const dss = makeDSS([
      ds({ SeriesInstanceUID: 's1', SeriesNumber: 2, Modality: 'MR' }),
      ds({ SeriesInstanceUID: 's2', SeriesNumber: 1, Modality: 'CT', displaySetInstanceUID: 'd2' }),
      ds({ SeriesInstanceUID: 's3', Modality: 'SR', displaySetInstanceUID: 'd3' }), // excluded
    ]);
    const { result } = renderHook(() =>
      useStudySeriesSelection({ displaySetService: dss as any, activeStudyUID: 'st1' })
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });
    expect(result.current.availableSeries.map((s: any) => s.SeriesInstanceUID)).toEqual(['s2', 's1']); // sorted by number
    expect(result.current.selectedSeriesUIDs.size).toBe(2); // auto-selected
    expect(result.current.isLoadingSeries).toBe(false);
  });

  it('clears series when activeStudyUID is null', async () => {
    const dss = makeDSS([ds()]);
    const { result } = renderHook(() =>
      useStudySeriesSelection({ displaySetService: dss as any, activeStudyUID: null })
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });
    expect(result.current.availableSeries).toEqual([]);
    expect(result.current.selectedSeriesUIDs.size).toBe(0);
  });

  it('reports an error after exhausting retries when display sets never arrive', async () => {
    const dss = makeDSS([]); // always empty
    const { result } = renderHook(() =>
      useStudySeriesSelection({ displaySetService: dss as any, activeStudyUID: 'st1' })
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(150 + 100 * 11);
    });
    expect(result.current.seriesError).toMatch(/Display sets not available/);
    expect(result.current.isLoadingSeries).toBe(false);
  });
});

describe('useStudySeriesSelection — selection actions', () => {
  async function loaded() {
    const dss = makeDSS([
      ds({ SeriesInstanceUID: 's1', SeriesNumber: 1 }),
      ds({ SeriesInstanceUID: 's2', SeriesNumber: 2, displaySetInstanceUID: 'd2' }),
    ]);
    const hook = renderHook(() =>
      useStudySeriesSelection({ displaySetService: dss as any, activeStudyUID: 'st1' })
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });
    return hook;
  }

  it('toggleSeries removes then re-adds a series', async () => {
    const { result } = await loaded();
    act(() => result.current.toggleSeries('s1'));
    expect(result.current.selectedSeriesUIDs.has('s1')).toBe(false);
    act(() => result.current.toggleSeries('s1'));
    expect(result.current.selectedSeriesUIDs.has('s1')).toBe(true);
  });

  it('clearSeriesSelection empties and selectAllSeries restores', async () => {
    const { result } = await loaded();
    act(() => result.current.clearSeriesSelection());
    expect(result.current.selectedSeriesUIDs.size).toBe(0);
    act(() => result.current.selectAllSeries());
    expect(result.current.selectedSeriesUIDs.size).toBe(2);
  });

  it('reset clears the selection and error', async () => {
    const { result } = await loaded();
    act(() => result.current.reset());
    expect(result.current.selectedSeriesUIDs.size).toBe(0);
    expect(result.current.seriesError).toBeNull();
  });
});

describe('useStudySeriesSelection — teardown', () => {
  it('unsubscribes both listeners and fires no timers after unmount', async () => {
    const dss = makeDSS([]); // empty → effect 3 schedules retry timers
    const { unmount } = renderHook(() =>
      useStudySeriesSelection({ displaySetService: dss as any, activeStudyUID: 'st1' })
    );
    // Two subscriptions: one from the studies effect, one from the series effect.
    expect(dss.subscribe).toHaveBeenCalledTimes(2);

    unmount();
    dss._unsubs.forEach(u => expect(u).toHaveBeenCalledTimes(1));

    // Advancing past all retry timers must not throw or update state post-unmount.
    expect(() => jest.advanceTimersByTime(2000)).not.toThrow();
  });
});
