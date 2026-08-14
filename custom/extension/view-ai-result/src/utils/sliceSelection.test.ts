import {
  canAddressSlices,
  clampRange,
  formatRange,
  formatSliceTally,
  initialRange,
  rangeSize,
  sampleSliceNumbers,
  selectedInstanceUIDs,
} from './sliceSelection';

describe('clampRange', () => {
  it('keeps a range that already fits', () => {
    expect(clampRange({ start: 18, end: 62 }, 103)).toEqual({ start: 18, end: 62 });
  });

  it('pulls an over-long range back to the volume depth', () => {
    expect(clampRange({ start: 5, end: 400 }, 103)).toEqual({ start: 5, end: 103 });
  });

  it('never produces a start below the first slice', () => {
    expect(clampRange({ start: -3, end: 10 }, 103)).toEqual({ start: 1, end: 10 });
  });

  it('never lets end fall below start', () => {
    // A crossed range would make rangeSize negative and the sampler silent.
    expect(clampRange({ start: 40, end: 12 }, 103)).toEqual({ start: 40, end: 40 });
  });

  it('survives an empty series', () => {
    expect(clampRange({ start: 1, end: 1 }, 0)).toEqual({ start: 1, end: 1 });
  });
});

describe('initialRange', () => {
  it('reproduces the central band the middleware already used', () => {
    // extract_slices drops (100-60)/2 = 20% from each end of a 20-slice volume:
    // 0-based indices 4..15, which are slices 5..16.
    expect(initialRange(20, 'central', 5, 60)).toEqual({ start: 5, end: 16 });
  });

  it('widens the central band as the percentage grows', () => {
    expect(initialRange(100, 'central', 5, 100)).toEqual({ start: 1, end: 100 });
  });

  it('covers the whole volume for the uniform strategy', () => {
    expect(initialRange(103, 'uniform', 5)).toEqual({ start: 1, end: 103 });
  });

  it('takes the leading slices for first_n', () => {
    expect(initialRange(103, 'first_n', 8)).toEqual({ start: 1, end: 8 });
  });

  it('takes the trailing slices for last_n', () => {
    expect(initialRange(103, 'last_n', 8)).toEqual({ start: 96, end: 103 });
  });

  it('clamps first_n when the volume is shorter than the request', () => {
    expect(initialRange(3, 'first_n', 8)).toEqual({ start: 1, end: 3 });
  });

  it('clamps last_n when the volume is shorter than the request', () => {
    expect(initialRange(3, 'last_n', 8)).toEqual({ start: 1, end: 3 });
  });

  it('falls back to the whole volume for an unknown strategy', () => {
    expect(initialRange(40, 'something-new', 5)).toEqual({ start: 1, end: 40 });
  });

  it('does not crash on a series with no slices', () => {
    expect(initialRange(0, 'central', 5)).toEqual({ start: 1, end: 1 });
  });
});

describe('sampleSliceNumbers', () => {
  it('includes both ends of the range', () => {
    const out = sampleSliceNumbers({ start: 18, end: 62 }, 12);
    expect(out[0]).toBe(18);
    expect(out[out.length - 1]).toBe(62);
    expect(out).toHaveLength(12);
  });

  it('spreads the slices evenly', () => {
    expect(sampleSliceNumbers({ start: 1, end: 21 }, 5)).toEqual([1, 6, 11, 16, 21]);
  });

  it('returns the midpoint for a single slice', () => {
    // The middle of what was selected, not an arbitrary end of it.
    expect(sampleSliceNumbers({ start: 10, end: 20 }, 1)).toEqual([15]);
  });

  it('returns ascending, distinct slice numbers', () => {
    const out = sampleSliceNumbers({ start: 4, end: 10 }, 6);
    expect(new Set(out).size).toBe(out.length);
    expect([...out].sort((a, b) => a - b)).toEqual(out);
  });

  it('never returns more slices than the range holds', () => {
    // "8 slices will be sent" would be a lie on a 3-slice range.
    expect(sampleSliceNumbers({ start: 7, end: 9 }, 8)).toEqual([7, 8, 9]);
  });

  it('returns nothing for a zero count', () => {
    expect(sampleSliceNumbers({ start: 1, end: 10 }, 0)).toEqual([]);
  });

  it('returns nothing for a negative count', () => {
    expect(sampleSliceNumbers({ start: 1, end: 10 }, -4)).toEqual([]);
  });

  it('handles a single-slice range', () => {
    expect(sampleSliceNumbers({ start: 27, end: 27 }, 5)).toEqual([27]);
  });

  it('is exhaustive when count equals the range size', () => {
    expect(sampleSliceNumbers({ start: 3, end: 7 }, 5)).toEqual([3, 4, 5, 6, 7]);
  });
});

describe('rangeSize', () => {
  it('counts both endpoints', () => {
    expect(rangeSize({ start: 18, end: 62 })).toBe(45);
  });

  it('is 1 for a single slice', () => {
    expect(rangeSize({ start: 5, end: 5 })).toBe(1);
  });

  it('never goes negative', () => {
    expect(rangeSize({ start: 9, end: 2 })).toBe(0);
  });
});

describe('selectedInstanceUIDs', () => {
  const uids = Array.from({ length: 10 }, (_, i) => `1.2.3.${i + 1}`);

  it('maps sampled slice numbers to the instances at those positions', () => {
    // Span 10, 3 slices: step 4.5, so slices 1, 6 and 10.
    expect(selectedInstanceUIDs(uids, { start: 1, end: 10 }, 3)).toEqual([
      '1.2.3.1',
      '1.2.3.6',
      '1.2.3.10',
    ]);
  });

  it('is 1-based: slice 1 is the first instance, not the second', () => {
    // An off-by-one here sends the neighbouring slice with no way to notice.
    expect(selectedInstanceUIDs(uids, { start: 1, end: 1 }, 1)).toEqual(['1.2.3.1']);
  });

  it('addresses the last slice without running off the end', () => {
    expect(selectedInstanceUIDs(uids, { start: 10, end: 10 }, 1)).toEqual(['1.2.3.10']);
  });

  it('clamps a range that exceeds the instance list', () => {
    const out = selectedInstanceUIDs(uids, { start: 8, end: 40 }, 3);
    expect(out).toEqual(['1.2.3.8', '1.2.3.9', '1.2.3.10']);
    expect(out.every(Boolean)).toBe(true);
  });

  it('returns nothing when the series has no instance list', () => {
    // The signal to fall back to the middleware's configured recipe.
    expect(selectedInstanceUIDs([], { start: 1, end: 10 }, 3)).toEqual([]);
  });
});

describe('canAddressSlices', () => {
  it('accepts one instance per slice', () => {
    expect(canAddressSlices(['a', 'b', 'c'], 3)).toBe(true);
  });

  it('rejects a multi-frame series', () => {
    // One SOPInstanceUID covering 40 frames cannot express "slices 18-62".
    expect(canAddressSlices(['a'], 40)).toBe(false);
  });

  it('rejects an empty instance list', () => {
    expect(canAddressSlices([], 0)).toBe(false);
  });

  it('rejects a partially loaded series', () => {
    // Fewer UIDs than frames means the mapping is incomplete, so a slice number
    // would point at the wrong instance.
    expect(canAddressSlices(['a', 'b'], 40)).toBe(false);
  });
});

describe('formatRange', () => {
  it('shows both ends of a multi-slice range', () => {
    expect(formatRange({ start: 18, end: 62 }, 103)).toBe('18–62 of 103');
  });

  it('shows a single slice once', () => {
    expect(formatRange({ start: 27, end: 27 }, 103)).toBe('27 of 103');
  });
});

describe('formatSliceTally', () => {
  it('pluralises', () => {
    expect(formatSliceTally(12)).toBe('12 slices');
  });

  it('does not pluralise one', () => {
    expect(formatSliceTally(1)).toBe('1 slice');
  });

  it('reports none as a count, not as a blank', () => {
    expect(formatSliceTally(0)).toBe('0 slices');
  });
});
