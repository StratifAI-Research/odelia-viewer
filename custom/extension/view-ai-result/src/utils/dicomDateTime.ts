export function formatDicomDateTime(
  date?: string,
  time?: string,
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

  // Parse timezone offset from DICOM (0008,0201) if provided
  // Accept formats "+HHMM", "-HHMM", "+HH:MM", "-HH:MM"
  let offsetMinutes = 0;
  if (tzOffset && /^[+-]\d{2}:?\d{2}$/.test(tzOffset)) {
    const cleaned = tzOffset.replace(':', '');
    const sign = cleaned[0] === '-' ? -1 : 1;
    const offHours = parseInt(cleaned.substring(1, 3), 10);
    const offMins = parseInt(cleaned.substring(3, 5), 10);
    offsetMinutes = sign * (offHours * 60 + offMins);
  }

  // Build UTC timestamp (treat input as local in the given offset)
  const utcMillis = Date.UTC(year, month, day, hour, minute, second) - offsetMinutes * 60 * 1000;

  // Convert to browser's local time
  const localDate = new Date(utcMillis);

  // Format as YYYY-MM-DD HH:MM:SS in local TZ
  const pad = (n: number) => n.toString().padStart(2, '0');
  const yyyy = localDate.getFullYear();
  const MM = pad(localDate.getMonth() + 1);
  const dd = pad(localDate.getDate());
  const HH = pad(localDate.getHours());
  const mm = pad(localDate.getMinutes());
  const ss = pad(localDate.getSeconds());

  return `${yyyy}-${MM}-${dd} ${HH}:${mm}:${ss}`;
}
