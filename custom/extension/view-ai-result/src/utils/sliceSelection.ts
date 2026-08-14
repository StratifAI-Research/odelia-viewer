/**
 * Which slices of a series a chat message sends.
 *
 * The panel shows the user two different numbers — the range they selected, and
 * the slices that will actually reach the model — so the sampling that turns one
 * into the other lives here, as pure functions, and is unit-tested. If these two
 * ever disagree with what the middleware receives, the message's provenance
 * footer becomes a false claim, which is the failure this module exists to
 * prevent.
 *
 * Everything here is 1-based and inclusive, matching the slice numbers the viewer
 * puts on screen. The conversion to 0-based indices happens only where instance
 * UIDs are looked up.
 */

/** A 1-based, inclusive slice range over one series. */
export interface SliceRange {
  start: number;
  end: number;
}

/**
 * Most slices one message may send per series.
 *
 * Matches the ceiling on the settings dialog's slice count. The wire protocol
 * allows a little more (`MAX_SLICES_PER_SERIES = 64` in the middleware), so this
 * limit is reached before validation ever rejects a payload.
 */
export const MAX_SLICES_PER_SERIES = 50;

/** Clamp a range into `[1, total]`, keeping start ≤ end. */
export function clampRange(range: SliceRange, total: number): SliceRange {
  if (total <= 0) {
    return { start: 1, end: 1 };
  }
  const start = Math.min(Math.max(1, Math.round(range.start)), total);
  const end = Math.min(Math.max(start, Math.round(range.end)), total);
  return { start, end };
}

/** Number of slices a range covers. */
export function rangeSize(range: SliceRange): number {
  return Math.max(0, range.end - range.start + 1);
}

/**
 * The range a series starts out with, derived from the middleware's configured
 * strategy.
 *
 * Seeded from the configuration rather than defaulting to the whole volume so
 * that opening the panel and pressing send keeps sampling the same *band* the
 * service was already sampling — the slider exposes the existing recipe instead
 * of quietly replacing it. (Within that band the sampling is uniform, so the
 * individual slices need not be identical to the strategy's own picks.)
 */
export function initialRange(
  total: number,
  strategy: string,
  numSlices: number,
  centralPercentage = 60
): SliceRange {
  if (total <= 0) {
    return { start: 1, end: 1 };
  }
  switch (strategy) {
    case 'central': {
      // Mirrors `extract_slices`: a margin of (100 - p)/2 percent is dropped from
      // each end.
      const margin = (100 - centralPercentage) / 200;
      const start = Math.floor(total * margin) + 1;
      const end = Math.max(start, Math.floor(total * (1 - margin)));
      return clampRange({ start, end }, total);
    }
    case 'first_n':
      return clampRange({ start: 1, end: numSlices }, total);
    case 'last_n':
      return clampRange({ start: total - numSlices + 1, end: total }, total);
    case 'uniform':
    default:
      return { start: 1, end: total };
  }
}

/**
 * The slice numbers that will actually be sent: `count` slices spread evenly
 * across `range`, both ends included.
 *
 * Returns fewer than `count` only when the range is smaller than the request —
 * a range of 3 slices cannot yield 8 — and the panel reports the returned length
 * rather than the request, so "12 slices will be sent" is never an overstatement.
 */
export function sampleSliceNumbers(range: SliceRange, count: number): number[] {
  const span = rangeSize(range);
  const wanted = Math.min(Math.max(0, Math.floor(count)), span);

  if (wanted <= 0) {
    return [];
  }
  if (wanted === 1) {
    // Midpoint, so a single slice is the middle of what the user selected rather
    // than an arbitrary end of it.
    return [range.start + Math.floor((span - 1) / 2)];
  }

  const step = (span - 1) / (wanted - 1);
  const numbers: number[] = [];
  for (let i = 0; i < wanted; i++) {
    numbers.push(range.start + Math.round(i * step));
  }
  // `step >= 1` because `wanted <= span`, and rounding preserves that ordering,
  // so these are strictly increasing and distinct.
  return numbers;
}

/**
 * The slices a message will send for one series, as SOPInstanceUIDs.
 *
 * Empty when the series cannot be addressed instance by instance — see
 * `canAddressSlices`. An empty list is the signal to fall back to the
 * middleware's configured recipe, and the panel says so rather than showing a
 * range it cannot honour.
 */
export function selectedInstanceUIDs(
  sopInstanceUIDs: string[],
  range: SliceRange,
  count: number
): string[] {
  if (sopInstanceUIDs.length === 0) {
    return [];
  }
  const bounded = clampRange(range, sopInstanceUIDs.length);
  return sampleSliceNumbers(bounded, count).map(n => sopInstanceUIDs[n - 1]);
}

/**
 * Whether a series can be addressed slice by slice.
 *
 * True only when the viewer holds one instance per slice. A multi-frame instance
 * is one SOPInstanceUID covering many slices, so naming it cannot express "slices
 * 18–62" — and guessing would send different pixels than the panel claims.
 */
export function canAddressSlices(sopInstanceUIDs: string[], numFrames: number): boolean {
  return sopInstanceUIDs.length > 0 && sopInstanceUIDs.length === numFrames;
}

/**
 * `18–62 of 103` — the selected range.
 *
 * A single-slice range reads as `27 of 103`: "27–27" invites the reader to look
 * for the second number.
 */
export function formatRange(range: SliceRange, total: number): string {
  if (range.start === range.end) {
    return `${range.start} of ${total}`;
  }
  return `${range.start}–${range.end} of ${total}`;
}

/** `12 slices` / `1 slice`. */
export function formatSliceTally(count: number): string {
  return `${count} slice${count === 1 ? '' : 's'}`;
}
