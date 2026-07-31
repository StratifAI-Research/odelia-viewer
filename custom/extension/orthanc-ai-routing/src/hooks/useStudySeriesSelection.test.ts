import { renderHook, act } from '@testing-library/react';
import { useStudySeriesSelection } from './useStudySeriesSelection';
// @ohif/core is mapped to a stub via moduleNameMapper (jest.config.js).
import { DicomMetadataStore } from '@ohif/core';

const RETRY_WINDOW = 150 + 100 * 11; // initial 150ms + 10 retries @100ms (source magic numbers)

function makeDSS(initial: any[]) {
  let current = initial;
  const listeners: Record<string, Array<(...args: any[]) => void>> = {};
  const unsubs: jest.Mock[] = [];
  return {
    EVENTS: { DISPLAY_SETS_CHANGED: 'changed' },
    getActiveDisplaySets: jest.fn(() => current),
    subscribe: jest.fn((evt: string, cb: (...args: any[]) => void) => {
      (listeners[evt] ||= []).push(cb);
      const unsubscribe = jest.fn();
      unsubs.push(unsubscribe);
      return { unsubscribe };
    }),
    _unsubs: unsubs,
    _emit: (evt: string) => (listeners[evt] || []).forEach(cb => cb()),
    _set: (next: any[]) => {
      current = next;
    },
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
  (DicomMetadataStore.getStudy as jest.Mock).mockReturnValue({ series: [] });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('useStudySeriesSelection — studies', () => {
  it('groups studies after the load delay, skipping SR/SC display sets', async () => {
    const dss = makeDSS([
      ds({ SeriesInstanceUID: 's1', Modality: 'MR' }),
      ds({ SeriesInstanceUID: 's2', Modality: 'SR', displaySetInstanceUID: 'd2' }),
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

  it('prefers the study description from DicomMetadataStore series metadata', async () => {
    (DicomMetadataStore.getStudy as jest.Mock).mockReturnValue({
      series: [
        {
          Modality: 'MR',
          instances: [{ StudyDescription: 'From-metadata', StudyDate: '20240601' }],
        },
      ],
    });
    const dss = makeDSS([ds({ StudyDate: '', StudyDescription: 'fallback-desc' })]);
    const { result } = renderHook(() =>
      useStudySeriesSelection({ displaySetService: dss as any, activeStudyUID: null })
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(150);
    });
    expect(result.current.availableStudies[0].description).toContain('From-metadata');
  });

  it('builds a description-only / date-only / "Unnamed Study" display name', async () => {
    const cases = [
      { in: { StudyDate: '', StudyDescription: 'OnlyDesc' }, expect: 'OnlyDesc' },
      { in: { StudyDate: '20240101', StudyDescription: '' }, expect: '20240101' },
      { in: { StudyDate: '', StudyDescription: '' }, expect: 'Unnamed Study' },
    ];
    for (const c of cases) {
      const dss = makeDSS([ds(c.in)]);
      const { result } = renderHook(() =>
        useStudySeriesSelection({ displaySetService: dss as any, activeStudyUID: null })
      );
      await act(async () => {
        await jest.advanceTimersByTimeAsync(150);
      });
      expect(result.current.availableStudies[0].description).toBe(c.expect);
    }
  });

  it('groups multiple distinct studies', async () => {
    const dss = makeDSS([
      ds({ StudyInstanceUID: 'st1', SeriesInstanceUID: 's1' }),
      ds({ StudyInstanceUID: 'st2', SeriesInstanceUID: 's2', displaySetInstanceUID: 'd2' }),
    ]);
    const { result } = renderHook(() =>
      useStudySeriesSelection({ displaySetService: dss as any, activeStudyUID: null })
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(150);
    });
    // NB: source sorts by Date.parse(formattedDate); the identity formatDate yields
    // non-ISO strings (NaN), so order is effectively insertion order — both present.
    expect(result.current.availableStudies.map((s: any) => s.studyInstanceUid).sort()).toEqual([
      'st1',
      'st2',
    ]);
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
      ds({ SeriesInstanceUID: 's3', Modality: 'SR', displaySetInstanceUID: 'd3' }),
    ]);
    const { result } = renderHook(() =>
      useStudySeriesSelection({ displaySetService: dss as any, activeStudyUID: 'st1' })
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });
    expect(result.current.availableSeries.map((s: any) => s.SeriesInstanceUID)).toEqual([
      's2',
      's1',
    ]);
    expect(result.current.selectedSeriesUIDs.size).toBe(2);
    expect(result.current.isLoadingSeries).toBe(false);
  });

  it('yields no series when the active study has only SR/SC display sets', async () => {
    const dss = makeDSS([
      ds({ StudyInstanceUID: 'st1', Modality: 'SR', SeriesInstanceUID: 's1' }),
      ds({
        StudyInstanceUID: 'st1',
        Modality: 'SC',
        SeriesInstanceUID: 's2',
        displaySetInstanceUID: 'd2',
      }),
    ]);
    const { result } = renderHook(() =>
      useStudySeriesSelection({ displaySetService: dss as any, activeStudyUID: 'st1' })
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });
    expect(result.current.availableSeries).toEqual([]);
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
    const dss = makeDSS([]);
    const { result } = renderHook(() =>
      useStudySeriesSelection({ displaySetService: dss as any, activeStudyUID: 'st1' })
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(RETRY_WINDOW);
    });
    expect(result.current.seriesError).toMatch(/Display sets not available/);
    expect(result.current.isLoadingSeries).toBe(false);
  });

  it('loads late-arriving series via the DISPLAY_SETS_CHANGED event after a retry', async () => {
    const dss = makeDSS([]); // empty at mount → enters retry loop
    const { result } = renderHook(() =>
      useStudySeriesSelection({ displaySetService: dss as any, activeStudyUID: 'st1' })
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(250); // first attempt + 1 retry → retryCount > 0
    });
    expect(result.current.availableSeries).toEqual([]);

    dss._set([ds({ SeriesInstanceUID: 's1' })]); // data arrives late
    await act(async () => {
      dss._emit('changed');
    });
    expect(result.current.availableSeries.map((s: any) => s.SeriesInstanceUID)).toEqual(['s1']);
  });
});

describe('useStudySeriesSelection — selection & retry actions', () => {
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
    return { dss, ...hook };
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

  it('retrySeries reloads series after data becomes available', async () => {
    const dss = makeDSS([]); // exhausts retries → error state
    const { result } = renderHook(() =>
      useStudySeriesSelection({ displaySetService: dss as any, activeStudyUID: 'st1' })
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(RETRY_WINDOW);
    });
    expect(result.current.seriesError).toBeTruthy();

    dss._set([ds({ SeriesInstanceUID: 's1' })]);
    act(() => result.current.retrySeries());
    expect(result.current.availableSeries.map((s: any) => s.SeriesInstanceUID)).toEqual(['s1']);
    expect(result.current.seriesError).toBeNull();
  });

  it('retrySeries surfaces an error when the store throws', async () => {
    const { result, dss } = await loaded();
    dss.getActiveDisplaySets.mockImplementation(() => {
      throw new Error('DICOMweb store failure');
    });
    act(() => result.current.retrySeries());
    expect(result.current.seriesError).toBeTruthy();
    expect(result.current.isLoadingSeries).toBe(false);
  });
});

describe('useStudySeriesSelection — teardown', () => {
  it('unsubscribes both listeners and does no work after unmount', async () => {
    const dss = makeDSS([]); // empty → series effect schedules retry timers
    const { unmount } = renderHook(() =>
      useStudySeriesSelection({ displaySetService: dss as any, activeStudyUID: 'st1' })
    );
    await act(async () => {
      await jest.advanceTimersByTimeAsync(150); // let one attempt run (retryCount > 0)
    });
    expect(dss.subscribe).toHaveBeenCalledTimes(2);

    const callsBefore = dss.getActiveDisplaySets.mock.calls.length;
    unmount();
    dss._unsubs.forEach(u => expect(u).toHaveBeenCalledTimes(1));

    // No timer may fire work after unmount: getActiveDisplaySets must not be called again.
    jest.advanceTimersByTime(2000);
    expect(dss.getActiveDisplaySets.mock.calls.length).toBe(callsBefore);
  });
});
