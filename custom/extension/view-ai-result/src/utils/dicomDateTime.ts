export function formatDicomDateTime(
  date?: string,
  time?: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  tzOffset?: string | null
): string | null {
  // Guard: date is required
  if (!date) {
    return null;
  }

  // Ensure date string length is 8 (YYYYMMDD)
  if (date.length !== 8) {
    return null;
  }

  // Parse date components
  const year = parseInt(date.substring(0, 4), 10);
  const month = parseInt(date.substring(4, 6), 10) - 1; // zero-based
  const day = parseInt(date.substring(6, 8), 10);

  // Reject non-numeric-but-8-char dates (e.g. "2024ABCD") so we never emit a
  // "NaN-NaN-NaN" label.
  if (Number.isNaN(year) || Number.isNaN(month) || Number.isNaN(day)) {
    return null;
  }

  // Default time components
  let hour = 0;
  let minute = 0;
  let second = 0;

  if (time && time.length >= 2) {
    hour = parseInt(time.substring(0, 2), 10);
    if (time.length >= 4) {
      minute = parseInt(time.substring(2, 4), 10);
    }
    if (time.length >= 6) {
      second = parseInt(time.substring(4, 6), 10);
    }
  }
  if (Number.isNaN(hour) || Number.isNaN(minute) || Number.isNaN(second)) {
    return null;
  }

  // Render the DICOM wall-clock components verbatim as "YYYY-MM-DD HH:MM:SS".
  // DICOM DA/TM values are naive, site-local timestamps. The previous
  // implementation round-tripped them through Date.UTC() + local getters,
  // which shifted the displayed value by the *viewer's* timezone (a date-only
  // value rendered as "2024-03-15 01:00:00" on a UTC+1 machine) and made the
  // suite fail off-UTC. This value is also used as an AI-tab grouping key, so a
  // deterministic, timezone-independent string is required. tzOffset is kept in
  // the signature for API compatibility but is intentionally not applied to a
  // display label.
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${year}-${pad(month + 1)}-${pad(day)} ${pad(hour)}:${pad(minute)}:${pad(second)}`;
}

/**
 * Convert DICOM Date/Time (+ optional TZ offset) to ISO-8601 UTC string.
 * Returns undefined if inputs are insufficient.
 */
export function dicomDateTimeToIsoUtc(
  date?: string,
  time?: string,
  tzOffset?: string | null
): string | undefined {
  if (!date) return undefined;
  if (date.length !== 8) return undefined;

  const year = parseInt(date.substring(0, 4), 10);
  const month = parseInt(date.substring(4, 6), 10) - 1; // zero-based
  const day = parseInt(date.substring(6, 8), 10);

  let hour = 0;
  let minute = 0;
  let second = 0;
  let millisecond = 0;

  if (time && time.length >= 2) {
    hour = parseInt(time.substring(0, 2), 10) || 0;
    if (time.length >= 4) minute = parseInt(time.substring(2, 4), 10) || 0;
    if (time.length >= 6) second = parseInt(time.substring(4, 6), 10) || 0;
    // fractional part after dot/comma
    if (time.length > 6 && (time[6] === '.' || time[6] === ',')) {
      const frac = time.substring(7);
      const msStr = (frac + '000').slice(0, 3);
      millisecond = parseInt(msStr, 10) || 0;
    }
  }

  // Parse timezone offset (e.g., +HHMM, -HH:MM)
  let offsetMinutes = 0;
  if (tzOffset && /^[+-]\d{2}:?\d{2}$/.test(tzOffset)) {
    const cleaned = tzOffset.replace(':', '');
    const sign = cleaned[0] === '-' ? -1 : 1;
    const offHours = parseInt(cleaned.substring(1, 3), 10) || 0;
    const offMins = parseInt(cleaned.substring(3, 5), 10) || 0;
    offsetMinutes = sign * (offHours * 60 + offMins);
  }

  // Interpret provided date/time in the specified TZ, convert to UTC epoch
  const localMillis = Date.UTC(year, month, day, hour, minute, second, millisecond);
  const utcMillis = localMillis - offsetMinutes * 60 * 1000;
  return new Date(utcMillis).toISOString();
}

/**
 * Derive an ISO-8601 UTC timestamp for an AI result from a display set, using the
 * standard DICOM date/time fallback chain (InstanceCreation → Series → Content → Study)
 * plus the instance timezone offset. Returns undefined when no usable date is present.
 * Consolidates the fallback chain previously inlined in AIResultsService/FeedbackPanel.
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
