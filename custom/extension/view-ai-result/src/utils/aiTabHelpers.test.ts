import {
  isAIResult,
  getRealDisplaySet,
  getCreationTzOffset,
  formatCreationDateTime,
  clearAITabCache,
  getAITabCacheSize,
} from './aiTabHelpers';

beforeEach(() => clearAITabCache());

describe('isAIResult', () => {
  it('is true for SR and SC (either casing of the modality key)', () => {
    expect(isAIResult({ Modality: 'SR' })).toBe(true);
    expect(isAIResult({ Modality: 'SC' })).toBe(true);
    expect(isAIResult({ modality: 'SR' })).toBe(true);
  });

  it('is false for other modalities and falsy input', () => {
    expect(isAIResult({ Modality: 'MR' })).toBe(false);
    expect(isAIResult(null)).toBe(false);
    expect(isAIResult(undefined)).toBe(false);
  });
});

describe('getRealDisplaySet', () => {
  it('returns the thumbnail uncached when no displaySetService is present', () => {
    const thumb = { displaySetInstanceUID: 'd1' };
    expect(getRealDisplaySet(thumb, null)).toBe(thumb);
    expect(getAITabCacheSize()).toBe(0);
  });

  it('resolves via displaySetService and caches the result', () => {
    const real = { displaySetInstanceUID: 'd1', instance: {} };
    const getDisplaySetByUID = jest.fn(() => real);
    const sm = { services: { displaySetService: { getDisplaySetByUID } } };

    const thumb = { displaySetInstanceUID: 'd1' };
    expect(getRealDisplaySet(thumb, sm)).toBe(real);
    expect(getAITabCacheSize()).toBe(1);

    // Second call is served from cache (service not hit again).
    expect(getRealDisplaySet(thumb, sm)).toBe(real);
    expect(getDisplaySetByUID).toHaveBeenCalledTimes(1);
  });

  it('falls back to the thumbnail (and caches it) when the lookup throws', () => {
    const getDisplaySetByUID = jest.fn(() => {
      throw new Error('boom');
    });
    const sm = { services: { displaySetService: { getDisplaySetByUID } } };
    const thumb = { displaySetInstanceUID: 'd2' };
    expect(getRealDisplaySet(thumb, sm)).toBe(thumb);
    expect(getAITabCacheSize()).toBe(1);
  });
});

describe('getCreationTzOffset', () => {
  it('prefers TimezoneOffsetFromUTC, then TimezoneOffset, else null', () => {
    expect(getCreationTzOffset({ instance: { TimezoneOffsetFromUTC: '+0100' } })).toBe('+0100');
    expect(getCreationTzOffset({ instance: { TimezoneOffset: '+0200' } })).toBe('+0200');
    expect(getCreationTzOffset({ instance: {} })).toBeNull();
    expect(getCreationTzOffset(undefined)).toBeNull();
  });
});

describe('formatCreationDateTime', () => {
  it('formats the instance creation date/time', () => {
    const out = formatCreationDateTime({
      instance: { InstanceCreationDate: '20240315', InstanceCreationTime: '120000' },
    });
    expect(out).toMatch(/2024-03-15/);
  });

  it('returns null when no creation date is present', () => {
    expect(formatCreationDateTime({ instance: {} })).toBeNull();
  });
});
