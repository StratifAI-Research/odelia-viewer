import { renderHook } from '@testing-library/react';

const mockGetSelectedAIResult = jest.fn();
jest.mock('../services/AIResultsService', () => ({
  getAIResultsService: () => ({ getSelectedAIResult: mockGetSelectedAIResult }),
}));

import { useAIResult } from './useAIResult';

const sm = { services: {} };

describe('useAIResult', () => {
  beforeEach(() => mockGetSelectedAIResult.mockReset());

  it('returns null when there are no display sets', () => {
    const { result } = renderHook(() => useAIResult([], sm));
    expect(result.current).toBeNull();
    expect(mockGetSelectedAIResult).not.toHaveBeenCalled();
  });

  it('resolves the selected AI result for the first display set study', () => {
    const aiResult = { studyInstanceUID: 's1', classification: 'positive' };
    mockGetSelectedAIResult.mockReturnValue(aiResult);
    const displaySets = [{ StudyInstanceUID: 's1' }];
    const { result } = renderHook(() => useAIResult(displaySets, sm));
    expect(mockGetSelectedAIResult).toHaveBeenCalledWith('s1', sm);
    expect(result.current).toBe(aiResult);
  });

  it('does not query the service when the first display set lacks a study UID', () => {
    const { result } = renderHook(() => useAIResult([{}], sm));
    expect(mockGetSelectedAIResult).not.toHaveBeenCalled();
    expect(result.current).toBeNull();
  });

  it('re-resolves when the display sets change', () => {
    mockGetSelectedAIResult.mockImplementation((uid: string) => ({ studyInstanceUID: uid }));
    const { result, rerender } = renderHook(({ ds }: any) => useAIResult(ds, sm), {
      initialProps: { ds: [{ StudyInstanceUID: 's1' }] },
    });
    expect(result.current).toEqual({ studyInstanceUID: 's1' });
    rerender({ ds: [{ StudyInstanceUID: 's2' }] });
    expect(result.current).toEqual({ studyInstanceUID: 's2' });
  });

  it('does not re-query when display sets reference is stable', () => {
    mockGetSelectedAIResult.mockReturnValue({ studyInstanceUID: 's1' });
    const displaySets = [{ StudyInstanceUID: 's1' }];
    const { rerender } = renderHook(() => useAIResult(displaySets, sm));
    rerender();
    rerender();
    expect(mockGetSelectedAIResult).toHaveBeenCalledTimes(1);
  });
});
