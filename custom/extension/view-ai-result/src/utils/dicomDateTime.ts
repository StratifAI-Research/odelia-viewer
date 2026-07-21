/**
 * DICOM date/time parsing + display formatting for AI results.
 *
 * Two concerns live here and are kept deliberately separate (ODV-223):
 *
 *   - `dicomDateTimeToIsoUtc` / `resultTsFromDisplaySet` produce machine
 *     timestamps used for identity-adjacent work (SR↔SC pairing time-proximity,
 *     `AIResult.resultTs`). They are strict: an out-of-range component yields
 *     "no timestamp" rather than a value `Date.UTC` silently normalized into a
 *     different date (month 13 → next year, hour 29 → next day, …).
 *
 *   - `formatDicomDateTime` produces a human-readable, timezone-labeled string
 *     for display only. It is NEVER used as a grouping/identity key — grouping
 *     keys off the DICOM SOP Instance UID (see `aiResultPairing` and the tab
 *     builders). Because display no longer drives identity, the label is free to
 *     be unambiguous about its timezone.
 */

/** DICOM DA is exactly 8 digits (`YYYYMMDD`). */
const DICOM_DATE_RE = /^\d{8}$/;
/**
 * DICOM TM built hierarchically so a component only appears when its
 * predecessors do: `HH`, `HHMM`, `HHMMSS`, `HHMMSS.FFFFFF`. Fractional seconds
 * are only valid after the seconds component (so `12.5` / `1234.5` are rejected).
 */
const DICOM_TIME_RE = /^(\d{2})(?:(\d{2})(?:(\d{2})(?:[.,](\d+))?)?)?$/;
/** DICOM timezone offset `(0008,0201)`: `+HHMM` / `-HH:MM`. */
const TZ_OFFSET_RE = /^([+-])(\d{2}):?(\d{2})$/;

/** DICOM offset range is -12:00 .. +14:00, in minutes. */
const MIN_OFFSET_MINUTES = -12 * 60;
const MAX_OFFSET_MINUTES = 14 * 60;

interface DateParts {
  year: number;
  month: number; // zero-based, ready for Date.UTC
  day: number;
}

interface TimeParts {
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
}

const pad = (n: number): string => n.toString().padStart(2, '0');
/** Zero-pad a non-negative, ≤4-digit year for display (`50` → `0050`). */
const pad4 = (n: number): string => n.toString().padStart(4, '0');

/**
 * Milliseconds since epoch for a UTC wall-clock, preserving years 0–99, which
 * `Date.UTC` would otherwise remap to 1900–1999. DICOM DA permits four-digit
 * Gregorian years, so `00500101` must stay year 50, not become 1950.
 */
function utcMillis(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  millisecond = 0
): number {
  const ms = Date.UTC(year, month, day, hour, minute, second, millisecond);
  if (year >= 0 && year <= 99) {
    const d = new Date(ms);
    d.setUTCFullYear(year);
    return d.getTime();
  }
  return ms;
}

/**
 * Parse + range-validate a DICOM DA (`YYYYMMDD`). Returns null for anything that
 * is not 8 digits (`2024ABCD`) or whose month/day are out of range (`20241399`),
 * so such a value never reaches `Date.UTC`, which would normalize it into a
 * different, wrong date.
 */
function parseDicomDate(date?: string): DateParts | null {
  if (!date || !DICOM_DATE_RE.test(date)) {
    return null;
  }
  const year = parseInt(date.slice(0, 4), 10);
  const month = parseInt(date.slice(4, 6), 10);
  const day = parseInt(date.slice(6, 8), 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  // Reject impossible calendar days (Feb 30, Apr 31, non-leap Feb 29) via an
  // explicit day-of-month bound. Computed directly (not through `Date.UTC`
  // round-tripping, which maps years 0–99 to 1900–1999 and would falsely reject
  // valid four-digit DICOM years 0001–0099).
  if (day > daysInMonth(year, month)) {
    return null;
  }
  return { year, month: month - 1, day };
}

/** Whether a Gregorian year is a leap year. */
function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/** Number of days in a 1-based month of the given year. */
function daysInMonth(year: number, month: number): number {
  const lengths = [31, isLeapYear(year) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  return lengths[month - 1];
}

/**
 * Parse + range-validate a DICOM TM (`HH[MM[SS[.FFFFFF]]]`). Returns null when
 * the value is malformed or out of range (hour > 23, minute > 59, second > 59).
 * Second 60 (a legal leap second in the TM VR) is rejected rather than passed to
 * `Date.UTC`, which would normalize `23:59:60` into the following day — leap
 * seconds do not occur in these AI-model timestamps, and refusing one degrades
 * gracefully to a date-only label instead of silently shifting the date. Callers
 * pass this only when a time string is present, so a null here means "present but
 * unusable" — distinct from "no time supplied".
 */
function parseDicomTime(time?: string): TimeParts | null {
  if (!time) {
    return null;
  }
  const m = DICOM_TIME_RE.exec(time);
  if (!m) {
    return null;
  }
  const hour = parseInt(m[1], 10);
  const minute = m[2] ? parseInt(m[2], 10) : 0;
  const second = m[3] ? parseInt(m[3], 10) : 0;
  if (hour > 23 || minute > 59 || second > 59) {
    return null;
  }
  // Pad/truncate the fractional part to milliseconds (DICOM allows up to 6 digits).
  const millisecond = m[4] ? parseInt((m[4] + '000').slice(0, 3), 10) : 0;
  return { hour, minute, second, millisecond };
}

/**
 * Parse a DICOM timezone offset to signed minutes, or null when it is absent or
 * malformed. A null result means the zone is *not established* — callers must
 * NOT assume UTC in that case (per DICOM: a missing `(0008,0201)` does not
 * default to UTC).
 */
function parseTzOffsetMinutes(tzOffset?: string | null): number | null {
  if (!tzOffset) {
    return null;
  }
  const m = TZ_OFFSET_RE.exec(tzOffset);
  if (!m) {
    return null;
  }
  const sign = m[1] === '-' ? -1 : 1;
  const hours = parseInt(m[2], 10);
  const minutes = parseInt(m[3], 10);
  if (minutes > 59) {
    return null;
  }
  const total = sign * (hours * 60 + minutes);
  // Reject offsets outside DICOM's permitted -12:00 .. +14:00 window (e.g.
  // "+1430", "-1400") rather than trusting a malformed value in a UTC label.
  if (total < MIN_OFFSET_MINUTES || total > MAX_OFFSET_MINUTES) {
    return null;
  }
  return total;
}

/**
 * Human-readable, timezone-labeled label for a DICOM InstanceCreation date/time
 * (ODV-223 display policy). For **display only** — never a grouping/identity key.
 *
 *   - no / invalid date            → `null`
 *   - date, no usable time         → `"YYYY-MM-DD"` (no invented `00:00:00`)
 *   - date + time + valid offset   → `"YYYY-MM-DD HH:MM:SS UTC"` — the wall-clock
 *       is converted to UTC via the offset, giving one common reference for a
 *       multi-timezone consortium.
 *   - date + time, offset absent   → `"YYYY-MM-DD HH:MM:SS (timezone unknown)"` —
 *       the stored wall-clock verbatim, explicitly labeled so it is not read as
 *       UTC or as browser-local. A missing `(0008,0201)` means the zone is not
 *       established, so we do not guess.
 *
 * The output never depends on the viewer's browser timezone.
 */
export function formatDicomDateTime(
  date?: string,
  time?: string,
  tzOffset?: string | null
): string | null {
  const d = parseDicomDate(date);
  if (!d) {
    return null;
  }

  const dateLabel = `${pad4(d.year)}-${pad(d.month + 1)}-${pad(d.day)}`;

  // Date-only: time is absent, or present but unusable → show just the date.
  const t = time ? parseDicomTime(time) : null;
  if (!t) {
    return dateLabel;
  }

  const offsetMinutes = parseTzOffsetMinutes(tzOffset);
  if (offsetMinutes !== null) {
    // Offset established → convert the wall-clock to a single UTC reference.
    // Read back via getUTC* so the result is independent of the runtime TZ.
    const utc = new Date(
      utcMillis(d.year, d.month, d.day, t.hour, t.minute, t.second) - offsetMinutes * 60000
    );
    return (
      `${pad4(utc.getUTCFullYear())}-${pad(utc.getUTCMonth() + 1)}-${pad(utc.getUTCDate())} ` +
      `${pad(utc.getUTCHours())}:${pad(utc.getUTCMinutes())}:${pad(utc.getUTCSeconds())} UTC`
    );
  }

  // Offset not established → render the stored wall-clock verbatim, labeled.
  return `${dateLabel} ${pad(t.hour)}:${pad(t.minute)}:${pad(t.second)} (timezone unknown)`;
}

/**
 * Convert DICOM Date/Time (+ optional TZ offset) to an ISO-8601 UTC string.
 * Returns undefined when the date is missing/invalid, or when a time is supplied
 * but is malformed/out of range (rather than emitting a normalized wrong value).
 * When no time is supplied the value is treated as midnight; when no offset is
 * supplied it is treated as UTC for the purpose of this machine timestamp.
 */
export function dicomDateTimeToIsoUtc(
  date?: string,
  time?: string,
  tzOffset?: string | null
): string | undefined {
  const d = parseDicomDate(date);
  if (!d) {
    return undefined;
  }

  let t: TimeParts = { hour: 0, minute: 0, second: 0, millisecond: 0 };
  if (time) {
    const parsed = parseDicomTime(time);
    if (!parsed) {
      // Time supplied but unusable: refuse a silently-normalized timestamp so
      // proximity pairing never matches on garbage.
      return undefined;
    }
    t = parsed;
  }

  const offsetMinutes = parseTzOffsetMinutes(tzOffset) ?? 0;
  const millis =
    utcMillis(d.year, d.month, d.day, t.hour, t.minute, t.second, t.millisecond) -
    offsetMinutes * 60000;
  return new Date(millis).toISOString();
}

/** Sentinel that sorts after any real ISO-8601 timestamp ("9" > "2"). */
const NO_DATE_SORT_KEY = '9999-12-31T23:59:59.999Z';

/**
 * Lexically-sortable key ordering AI results by their true UTC instant, so the
 * display order matches the labeled-UTC timestamps even when results carry
 * different DICOM offsets — while staying independent of the viewer's browser
 * timezone (ODV-223). A value with a valid date but an unusable time falls back
 * to date-only (midnight); a value with no usable date sorts last.
 */
export function creationSortKey(date?: string, time?: string, tzOffset?: string | null): string {
  return (
    dicomDateTimeToIsoUtc(date, time, tzOffset) ||
    dicomDateTimeToIsoUtc(date, undefined, tzOffset) ||
    NO_DATE_SORT_KEY
  );
}

/**
 * Derive an ISO-8601 UTC timestamp for an AI result from a display set, using the
 * standard DICOM date/time fallback chain (InstanceCreation → Series → Content → Study)
 * plus the instance timezone offset. Returns undefined when no usable date is present.
 */
export function resultTsFromDisplaySet(displaySet?: any): string | undefined {
  if (!displaySet) {
    return undefined;
  }
  const instance = displaySet.instance;
  const date =
    instance?.InstanceCreationDate ||
    displaySet.SeriesDate ||
    displaySet.ContentDate ||
    displaySet.StudyDate;
  const time =
    instance?.InstanceCreationTime ||
    displaySet.SeriesTime ||
    displaySet.ContentTime ||
    displaySet.StudyTime;
  const tzOffset = instance?.TimezoneOffsetFromUTC || null;
  return dicomDateTimeToIsoUtc(date, time, tzOffset);
}
