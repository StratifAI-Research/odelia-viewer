import { getPrimaryDisplaySets, getPrimaryDisplaySet } from './displaySetFilters';

describe('displaySetFilters', () => {
  const mockDisplaySets = [
    { Modality: 'MR', displaySetInstanceUID: 'ds-1' },
    { Modality: 'SR', displaySetInstanceUID: 'ds-2' },
    { Modality: 'SC', displaySetInstanceUID: 'ds-3' },
    { Modality: 'CT', displaySetInstanceUID: 'ds-4' },
  ];

  describe('getPrimaryDisplaySets', () => {
    it('filters out SR and SC modalities', () => {
      const result = getPrimaryDisplaySets(mockDisplaySets);
      expect(result).toHaveLength(2);
      expect(result.map(ds => ds.Modality)).toEqual(['MR', 'CT']);
    });

    it('returns empty array when all display sets are AI artifacts', () => {
      const aiOnly = [
        { Modality: 'SR', displaySetInstanceUID: 'ds-1' },
        { Modality: 'SC', displaySetInstanceUID: 'ds-2' },
      ];
      expect(getPrimaryDisplaySets(aiOnly)).toHaveLength(0);
    });

    it('returns all when no AI artifacts present', () => {
      const noAI = [
        { Modality: 'MR', displaySetInstanceUID: 'ds-1' },
        { Modality: 'CT', displaySetInstanceUID: 'ds-2' },
      ];
      expect(getPrimaryDisplaySets(noAI)).toHaveLength(2);
    });
  });

  describe('getPrimaryDisplaySet', () => {
    it('returns the first primary display set', () => {
      const result = getPrimaryDisplaySet(mockDisplaySets);
      expect(result).toBeDefined();
      expect(result.Modality).toBe('MR');
    });

    it('returns null when no primary display sets exist', () => {
      const aiOnly = [{ Modality: 'SR', displaySetInstanceUID: 'ds-1' }];
      expect(getPrimaryDisplaySet(aiOnly)).toBeNull();
    });
  });
});
