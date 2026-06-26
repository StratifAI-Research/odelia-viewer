// Re-require the module before each test so its internal date cache starts
// empty; tests then don't depend on every case using a unique UID.
let getStaticDate: typeof import('./dateCache').getStaticDate;

beforeEach(() => {
  jest.resetModules();
  ({ getStaticDate } = require('./dateCache'));
});

describe('getStaticDate', () => {
  it('formats an 8-char DICOM date as MM/DD/YYYY', () => {
    const ds = { displaySetInstanceUID: 'dc-fmt', StudyDate: '20240315' };
    expect(getStaticDate(ds)).toBe('03/15/2024');
  });

  it('returns the same cached value once stored, ignoring later input changes', () => {
    const first = getStaticDate({ displaySetInstanceUID: 'dc-cache', StudyDate: '20240101' });
    expect(first).toBe('01/01/2024');
    // Same UID, different date -> cache hit returns the original stored value.
    const second = getStaticDate({ displaySetInstanceUID: 'dc-cache', StudyDate: '20251231' });
    expect(second).toBe(first);
  });

  it('prefers InstanceCreationDate for SR and SC modalities', () => {
    const sr = {
      displaySetInstanceUID: 'dc-sr',
      Modality: 'SR',
      SeriesDate: '20200101',
      instance: { InstanceCreationDate: '20240620' },
    };
    expect(getStaticDate(sr)).toBe('06/20/2024');

    const sc = {
      displaySetInstanceUID: 'dc-sc',
      Modality: 'SC',
      instance: { InstanceCreationDate: '20240101' },
    };
    expect(getStaticDate(sc)).toBe('01/01/2024');
  });

  it('falls back to SeriesDate then StudyDate', () => {
    expect(
      getStaticDate({ displaySetInstanceUID: 'dc-series', SeriesDate: '20221111', StudyDate: '20200101' })
    ).toBe('11/11/2022');
    expect(
      getStaticDate({ displaySetInstanceUID: 'dc-study', StudyDate: '20200101' })
    ).toBe('01/01/2020');
  });

  it('falls back to dates nested in the instance object', () => {
    const ds = { displaySetInstanceUID: 'dc-inst', instance: { StudyDate: '20191225' } };
    expect(getStaticDate(ds)).toBe('12/25/2019');
  });

  it('returns empty string when no date fields are present', () => {
    expect(getStaticDate({ displaySetInstanceUID: 'dc-none' })).toBe('');
  });

  it('does not throw when displaySet has no UID and no dates', () => {
    expect(() => getStaticDate({})).not.toThrow();
    expect(getStaticDate({})).toBe('');
  });

  it('stringifies non-DICOM-length date values', () => {
    expect(getStaticDate({ displaySetInstanceUID: 'dc-raw', StudyDate: '2024' })).toBe('2024');
  });
});
