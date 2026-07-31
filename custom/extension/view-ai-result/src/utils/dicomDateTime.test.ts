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

    it('returns null for an out-of-range date (month 13 / day 99)', () => {
      // Would otherwise be silently normalized by Date.UTC into a different date.
      expect(formatDicomDateTime('20241301')).toBeNull();
      expect(formatDicomDateTime('20240199')).toBeNull();
    });

    it('returns null for an impossible calendar day (Feb 30, Apr 31, non-leap Feb 29)', () => {
      expect(formatDicomDateTime('20240230')).toBeNull();
      expect(formatDicomDateTime('20240431')).toBeNull();
      expect(formatDicomDateTime('20230229')).toBeNull();
      // A real leap day is still accepted.
      expect(formatDicomDateTime('20240229')).toBe('2024-02-29');
    });

    it('accepts and preserves a valid four-digit year below 100 (no 1900s remap)', () => {
      // A naive Date.UTC path would remap year 0050 → 1950.
      expect(formatDicomDateTime('00500101')).toBe('0050-01-01');
      expect(formatDicomDateTime('00500101', '120000', '+0000')).toBe('0050-01-01 12:00:00 UTC');
    });

    it('shows the date only (no invented 00:00:00) when there is no time', () => {
      // Independent of the runtime timezone.
      expect(formatDicomDateTime('20240315')).toBe('2024-03-15');
    });

    it('shows the date only when the time is present but out of range', () => {
      // A garbage time never yields a garbage clock; fall back to the date.
      expect(formatDicomDateTime('20240315', '250000')).toBe('2024-03-15');
    });

    it('labels a value with no timezone offset as (timezone unknown), verbatim', () => {
      expect(formatDicomDateTime('20240315', '143022')).toBe(
        '2024-03-15 14:30:22 (timezone unknown)'
      );
    });

    it('converts to a labeled UTC reference when the offset is present', () => {
      // +0000 → wall-clock is already UTC.
      expect(formatDicomDateTime('20240315', '120000', '+0000')).toBe('2024-03-15 12:00:00 UTC');
      // +0200 → 12:00 local is 10:00 UTC.
      expect(formatDicomDateTime('20240315', '120000', '+0200')).toBe('2024-03-15 10:00:00 UTC');
      // Colon-form offset is accepted too.
      expect(formatDicomDateTime('20240315', '120000', '-05:30')).toBe('2024-03-15 17:30:00 UTC');
    });

    it('produces the same UTC label regardless of the runtime timezone', () => {
      // getUTC* readback → deterministic; the crossing-midnight case is the tell.
      expect(formatDicomDateTime('20240315', '003000', '+0200')).toBe('2024-03-14 22:30:00 UTC');
    });

    it('date-only ignores the offset (no time to convert)', () => {
      expect(formatDicomDateTime('20240315', undefined, '+0200')).toBe('2024-03-15');
    });

    it('treats an out-of-range offset as unknown rather than trusting it', () => {
      // +1430 / -1400 are outside DICOM's -12:00..+14:00 range → not applied.
      expect(formatDicomDateTime('20240315', '120000', '+1430')).toBe(
        '2024-03-15 12:00:00 (timezone unknown)'
      );
      expect(formatDicomDateTime('20240315', '120000', '-1400')).toBe(
        '2024-03-15 12:00:00 (timezone unknown)'
      );
      // The boundary values are still accepted and applied.
      expect(formatDicomDateTime('20240315', '120000', '+1400')).toBe('2024-03-14 22:00:00 UTC');
    });

    it('shows date only for a fraction not preceded by seconds (12.5 / 1234.5)', () => {
      expect(formatDicomDateTime('20240315', '12.5')).toBe('2024-03-15');
      expect(formatDicomDateTime('20240315', '1234.5')).toBe('2024-03-15');
    });

    it('shows date only for a leap second (23:59:60), never rolling to the next day', () => {
      expect(formatDicomDateTime('20240315', '235960')).toBe('2024-03-15');
      expect(formatDicomDateTime('20240315', '235960', '+0000')).toBe('2024-03-15');
    });
  });

  describe('dicomDateTimeToIsoUtc', () => {
    it('returns undefined when date is missing', () => {
      expect(dicomDateTimeToIsoUtc(undefined)).toBeUndefined();
    });

    it('returns undefined for malformed date', () => {
      expect(dicomDateTimeToIsoUtc('2024')).toBeUndefined();
    });

    it('returns undefined (does not throw) for a non-numeric 8-char date', () => {
      expect(() => dicomDateTimeToIsoUtc('2024ABCD')).not.toThrow();
      expect(dicomDateTimeToIsoUtc('2024ABCD')).toBeUndefined();
    });

    it('returns undefined for an out-of-range date rather than normalizing it', () => {
      // Date.UTC(2024, 12, ...) would roll into 2025; Date.UTC(..., 99) into next month.
      expect(dicomDateTimeToIsoUtc('20241301')).toBeUndefined();
      expect(dicomDateTimeToIsoUtc('20240199')).toBeUndefined();
    });

    it('returns undefined when the time is present but out of range', () => {
      // hour 29 would otherwise roll Date.UTC into the next day.
      expect(dicomDateTimeToIsoUtc('20240315', '290000')).toBeUndefined();
    });

    it('returns undefined for an impossible calendar day', () => {
      expect(dicomDateTimeToIsoUtc('20240230')).toBeUndefined();
      expect(dicomDateTimeToIsoUtc('20230229')).toBeUndefined();
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
        instance: {
          InstanceCreationDate: '20240315',
          InstanceCreationTime: '120000',
          TimezoneOffsetFromUTC: '+0000',
        },
      });
      const plus2 = resultTsFromDisplaySet({
        instance: {
          InstanceCreationDate: '20240315',
          InstanceCreationTime: '140000',
          TimezoneOffsetFromUTC: '+0200',
        },
      });
      expect(utc).toEqual(plus2);
    });

    it('returns undefined when no date field is present', () => {
      expect(resultTsFromDisplaySet({ instance: {} })).toBeUndefined();
    });
  });
});
