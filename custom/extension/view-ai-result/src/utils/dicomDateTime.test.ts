import { formatDicomDateTime, dicomDateTimeToIsoUtc } from './dicomDateTime';

describe('dicomDateTime utils', () => {
  describe('formatDicomDateTime', () => {
    it('returns null when date is missing', () => {
      expect(formatDicomDateTime(undefined)).toBeNull();
      expect(formatDicomDateTime('')).toBeNull();
    });

    it('returns null for malformed date (wrong length)', () => {
      expect(formatDicomDateTime('2024')).toBeNull();
      expect(formatDicomDateTime('202401011')).toBeNull();
    });

    it('formats date-only input', () => {
      const result = formatDicomDateTime('20240315');
      expect(result).toMatch(/2024-03-15 00:00:00/);
    });

    it('formats date + time input', () => {
      const result = formatDicomDateTime('20240315', '143022');
      expect(result).toBeDefined();
      expect(result).toContain('2024');
    });

    it('handles timezone offset', () => {
      const result = formatDicomDateTime('20240315', '120000', '+0000');
      expect(result).toBeDefined();
    });
  });

  describe('dicomDateTimeToIsoUtc', () => {
    it('returns undefined when date is missing', () => {
      expect(dicomDateTimeToIsoUtc(undefined)).toBeUndefined();
    });

    it('returns undefined for malformed date', () => {
      expect(dicomDateTimeToIsoUtc('2024')).toBeUndefined();
    });

    it('converts date-only to ISO UTC', () => {
      const result = dicomDateTimeToIsoUtc('20240315');
      expect(result).toBeDefined();
      expect(result).toContain('2024-03-15');
      expect(result!.endsWith('Z')).toBe(true);
    });

    it('converts date+time to ISO UTC', () => {
      const result = dicomDateTimeToIsoUtc('20240315', '143022');
      expect(result).toBeDefined();
      expect(result).toContain('T');
      expect(result!.endsWith('Z')).toBe(true);
    });

    it('handles fractional seconds', () => {
      const result = dicomDateTimeToIsoUtc('20240315', '143022.123456');
      expect(result).toBeDefined();
      expect(result).toContain('.123');
    });

    it('applies timezone offset correctly', () => {
      const utc = dicomDateTimeToIsoUtc('20240315', '120000', '+0000');
      const plus2 = dicomDateTimeToIsoUtc('20240315', '140000', '+0200');
      expect(utc).toEqual(plus2);
    });
  });
});
