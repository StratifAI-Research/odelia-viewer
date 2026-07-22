import {
  formatDicomDateTime,
  dicomDateTimeToIsoUtc,
  resultTsFromDisplaySet,
} from './dicomDateTime';

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

    it('returns null for a non-numeric 8-char date', () => {
      expect(formatDicomDateTime('2024ABCD')).toBeNull();
    });

    it('formats date-only input verbatim, independent of the runtime timezone', () => {
      // Naive DICOM DA rendering: must be exactly midnight regardless of TZ.
      expect(formatDicomDateTime('20240315')).toBe('2024-03-15 00:00:00');
    });

    it('formats date + time input verbatim', () => {
      expect(formatDicomDateTime('20240315', '143022')).toBe('2024-03-15 14:30:22');
    });

    it('ignores tzOffset for the display label (naive rendering)', () => {
      expect(formatDicomDateTime('20240315', '120000', '+0000')).toBe('2024-03-15 12:00:00');
      expect(formatDicomDateTime('20240315', '120000', '+0200')).toBe('2024-03-15 12:00:00');
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

  describe('resultTsFromDisplaySet', () => {
    it('returns undefined for a null/undefined display set', () => {
      expect(resultTsFromDisplaySet(undefined)).toBeUndefined();
      expect(resultTsFromDisplaySet(null)).toBeUndefined();
    });

    it('prefers instance InstanceCreationDate/Time over series/study fields', () => {
      const ds = {
        instance: { InstanceCreationDate: '20240315', InstanceCreationTime: '120000' },
        SeriesDate: '20200101',
        StudyDate: '20100101',
      };
      expect(resultTsFromDisplaySet(ds)).toBe(dicomDateTimeToIsoUtc('20240315', '120000', null));
    });

    it('falls back through Series -> Content -> Study when instance is absent', () => {
      expect(resultTsFromDisplaySet({ SeriesDate: '20240315', SeriesTime: '090000' })).toContain(
        '2024-03-15'
      );
      expect(resultTsFromDisplaySet({ ContentDate: '20240316' })).toContain('2024-03-16');
      expect(resultTsFromDisplaySet({ StudyDate: '20240317' })).toContain('2024-03-17');
    });

    it('applies the instance timezone offset', () => {
      const utc = resultTsFromDisplaySet({
        instance: { InstanceCreationDate: '20240315', InstanceCreationTime: '120000', TimezoneOffsetFromUTC: '+0000' },
      });
      const plus2 = resultTsFromDisplaySet({
        instance: { InstanceCreationDate: '20240315', InstanceCreationTime: '140000', TimezoneOffsetFromUTC: '+0200' },
      });
      expect(utc).toEqual(plus2);
    });

    it('returns undefined when no date field is present', () => {
      expect(resultTsFromDisplaySet({ instance: {} })).toBeUndefined();
    });
  });
});
