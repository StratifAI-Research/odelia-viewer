import { getPrimaryDisplaySets, getPrimaryDisplaySet } from './displaySetFilters';

const ds = (uid: string, Modality: string) => ({ displaySetInstanceUID: uid, Modality });

describe('getPrimaryDisplaySets', () => {
  it('keeps primary imaging modalities and drops SR/SC', () => {
    const list = [ds('a', 'MR'), ds('b', 'SR'), ds('c', 'CT'), ds('d', 'SC')];
    const out = getPrimaryDisplaySets(list);
    expect(out.map(d => d.displaySetInstanceUID)).toEqual(['a', 'c']);
  });

  it('returns an empty array for an empty list', () => {
    expect(getPrimaryDisplaySets([])).toEqual([]);
  });

  it('returns an empty array when every entry is an AI result', () => {
    expect(getPrimaryDisplaySets([ds('a', 'SR'), ds('b', 'SC')])).toEqual([]);
  });

  it('keeps everything when nothing is an AI result', () => {
    const list = [ds('a', 'MR'), ds('b', 'US')];
    expect(getPrimaryDisplaySets(list)).toHaveLength(2);
  });
});

describe('getPrimaryDisplaySet', () => {
  it('returns the first primary display set', () => {
    const list = [ds('sr', 'SR'), ds('first', 'MR'), ds('second', 'CT')];
    expect(getPrimaryDisplaySet(list)!.displaySetInstanceUID).toBe('first');
  });

  it('returns null when there is no primary display set', () => {
    expect(getPrimaryDisplaySet([ds('a', 'SR')])).toBeNull();
    expect(getPrimaryDisplaySet([])).toBeNull();
  });
});
