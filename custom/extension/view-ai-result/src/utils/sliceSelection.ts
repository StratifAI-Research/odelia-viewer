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
 * What the middleware will ship in one message, until it says otherwise.
 *
 * A transport guard, not a model limit: every slice is a WADO retrieval, a
 * decode and a base64 PNG in the request body. The real value is reported by
 * `/debug/config`; this stands in only before the config has loaded.
 */
export const FALLBACK_TRANSPORT_LIMIT = 128;

/**
 * Tokens one slice costs a model that does not report the figure.
 *
 * Ollama reports it per model (`<arch>.mm.tokens_per_image`). OpenRouter does
 * not — `per_request_limits` is null for its whole catalogue, and the true cost
 * depends on which provider the request is brokered to. 1500 is deliberately on
 * the high side: overstating the cost understates how many slices fit, which
 * fails towards a request the model can actually answer.
 */
export const ASSUMED_TOKENS_PER_IMAGE = 1500;

/**
 * Context left for everything that is not a slice: the system prompt, the
 * conversation so far, the question, and the answer being generated.
 */
export const TEXT_TOKEN_RESERVE = 8192;

/** What a model reports about its own budget. Either field may be absent. */
export interface ModelBudget {
  contextLength?: number | null;
  tokensPerImage?: number | null;
}

/** Why a slice count is bounded where it is — the UI says which one bit. */
export type SliceLimitReason = 'model' | 'estimate' | 'transport';

export interface SliceLimit {
  limit: number;
  reason: SliceLimitReason;
  /** Present when the bound came from the model's context, for explaining it. */
  contextLength?: number;
  tokensPerImage?: number;
}

/**
 * How many slices one series may send to a given model.
 *
 * Derived rather than fixed. A hard-coded ceiling is wrong in both directions at
 * once: it truncated a 131072-token model that fits some five hundred slices at
 * 256 tokens each, while leaving an 8k-context model free to be sent fifty
 * images it cannot read.
 *
 * The smaller of what the model can hold and what the pipeline will ship wins,
 * and `reason` names which — so a truncated selection can say why instead of
 * looking like arithmetic that does not add up.
 */
export function maxSlicesForModel(
  budget: ModelBudget | null | undefined,
  transportLimit: number = FALLBACK_TRANSPORT_LIMIT
): SliceLimit {
  const transport = Math.max(1, Math.floor(transportLimit));
  const context = budget?.contextLength;

  if (typeof context !== 'number' || context <= 0) {
    return { limit: transport, reason: 'transport' };
  }

  const reported = budget?.tokensPerImage;
  const perImage =
    typeof reported === 'number' && reported > 0 ? reported : ASSUMED_TOKENS_PER_IMAGE;
  const reason: SliceLimitReason =
    typeof reported === 'number' && reported > 0 ? 'model' : 'estimate';

  // At least one: a model too small to hold a slice alongside its prompt still
  // has to be offered the slice, or the panel would send an empty message.
  const fits = Math.max(1, Math.floor((context - TEXT_TOKEN_RESERVE) / perImage));

  return fits <= transport
    ? { limit: fits, reason, contextLength: context, tokensPerImage: perImage }
    : { limit: transport, reason: 'transport' };
}

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
 * How far either side of the viewer's slice the followed range reaches.
 *
 * One. The neighbours are there so the model sees a structure in context rather
 * than a single plane through it, and three images is small enough that the
 * range still means "what you are looking at". Widening it is a deliberate act,
 * and doing so pins the context.
 */
export const FOLLOW_NEIGHBOURS = 1;

/**
 * The range around the slice the viewer is showing: that slice, one before, one
 * after, clamped to the series.
 *
 * Clamped rather than shifted at the ends: at slice 1 this yields 1–2, not 1–3.
 * Sliding the window would send anatomy the reader is not looking at, and the
 * whole point of following is that the two agree.
 */
export function rangeAroundSlice(sliceNumber: number, total: number): SliceRange {
  if (total <= 0) {
    return { start: 1, end: 1 };
  }
  return clampRange(
    { start: sliceNumber - FOLLOW_NEIGHBOURS, end: sliceNumber + FOLLOW_NEIGHBOURS },
    total
  );
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
