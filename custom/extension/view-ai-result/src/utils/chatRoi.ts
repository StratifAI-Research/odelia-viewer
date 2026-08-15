/**
 * The chat panel's region of interest: turning a drawn rectangle into something
 * the middleware can crop with, and answering where it is on screen.
 *
 * Pure and unit-tested, because a wrong rectangle is invisible: the model simply
 * answers about the wrong piece of anatomy, confidently, and the transcript still
 * reads as if the right region had been sent.
 *
 * The rectangle leaves here as fractions of the image, not pixels. The viewer
 * measures it in the instance's pixel grid; the middleware crops the volume it
 * reconstructed itself. Those two grids match today, but a fraction survives them
 * diverging, and it cannot address a pixel outside the image the way a stale
 * pixel box could.
 */

/** A crop rectangle, in fractions of the image from its top-left corner. */
export interface RoiRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Which slices a region of interest applies to.
 *
 * Only `range` is produced now: a region crops every slice the message sends,
 * and narrowing that to one slice is what the slice-range slider is for. The
 * panel used to offer the choice as an "Apply to" control, so `slice` still
 * appears in snapshots taken while it existed and must keep rendering — a
 * message that really did send one cropped slice must not start claiming it
 * sent a cropped range.
 */
export type RoiScope = 'slice' | 'range';

/** A region the user drew, with everything needed to describe it afterwards. */
export interface ChatRoi {
  /** The images it was drawn on. */
  displaySetInstanceUID: string;
  /** 1-based slice it was drawn on. */
  sliceNumber: number;
  rect: RoiRect;
  /** Cornerstone's handle on the drawn annotation, so it can be erased again. */
  annotationUID: string;
}

/**
 * A drag under this many pixels in either direction is a click, not a rectangle.
 *
 * Without a floor, a stray click produces a sliver the middleware would dutifully
 * crop to — a few pixels of nothing, sent to the model as though it were the
 * region asked about.
 */
const MIN_DRAG_PX = 3;

const clamp = (value: number, low: number, high: number): number =>
  Math.min(Math.max(value, low), high);

/**
 * Convert the corners of a drawn rectangle into a fractional crop.
 *
 * Takes image-space points (column, row), as `worldToImageCoords` produces, and
 * the image's own dimensions. Returns null when the result would not be a usable
 * rectangle — too small, or outside an image whose size is unknown — so callers
 * have one thing to check rather than a rectangle that is quietly nonsense.
 */
export function toFractionalRect(
  points: Array<[number, number] | number[]>,
  columns: number,
  rows: number
): RoiRect | null {
  if (!points || points.length === 0 || columns <= 0 || rows <= 0) {
    return null;
  }
  const xs = points.map(p => p[0]).filter(Number.isFinite);
  const ys = points.map(p => p[1]).filter(Number.isFinite);
  if (xs.length === 0 || ys.length === 0) {
    return null;
  }

  // Clamped to the image: cornerstone happily reports a drag that ran off the
  // edge, and the middleware rejects a rectangle that does not fit.
  const left = clamp(Math.min(...xs), 0, columns);
  const right = clamp(Math.max(...xs), 0, columns);
  const top = clamp(Math.min(...ys), 0, rows);
  const bottom = clamp(Math.max(...ys), 0, rows);

  const width = right - left;
  const height = bottom - top;
  if (width < MIN_DRAG_PX || height < MIN_DRAG_PX) {
    return null;
  }

  return {
    x: left / columns,
    y: top / rows,
    width: width / columns,
    height: height / rows,
  };
}

/**
 * Whether a canvas point lies within the rectangle two opposite corners span.
 *
 * Cornerstone's own hit test for a rectangle measures distance to the *outline*,
 * so only a 6px band around the border can be grabbed. That is enough to resize
 * a measurement whose position is the finding, and not enough to move a region
 * someone drew to point at something: the obvious gesture — press inside it and
 * drag — lands on window/level instead, and the rectangle sits where it was.
 *
 * Corners rather than an origin and extent because that is what the annotation
 * stores, and either diagonal may be given: the user can drag a rectangle out in
 * any direction, so neither corner is reliably the top-left one.
 */
export function isPointInsideCorners(
  point: number[],
  cornerA: number[],
  cornerB: number[]
): boolean {
  const [x, y] = point ?? [];
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return false;
  }
  const within = (value: number, a: number, b: number) =>
    Number.isFinite(a) && Number.isFinite(b) && value >= Math.min(a, b) && value <= Math.max(a, b);
  return within(x, cornerA?.[0], cornerB?.[0]) && within(y, cornerA?.[1], cornerB?.[1]);
}

/** `ROI · slice 27` — the attachment chip's label. */
export function formatRoiLabel(sliceNumber: number): string {
  return `ROI · slice ${sliceNumber}`;
}

/**
 * Human name for a scope, for the provenance snapshot.
 *
 * Both names are still needed even though only `range` is produced: a snapshot
 * taken while the "Apply to" control existed can carry either, and it describes
 * what that message sent.
 */
export function formatRoiScope(scope: RoiScope): string {
  return scope === 'slice' ? 'Current slice' : 'Selected slice range';
}

/**
 * The region as percentages: `x 24%, y 31%, 18%×22%`.
 *
 * For the expanded provenance snapshot. Percentages rather than raw fractions
 * because the number a reader wants is "roughly where on the image", and six
 * decimal places of a fraction obscures that.
 */
export function formatRoiRect(rect: RoiRect): string {
  const pct = (v: number) => `${Math.round(v * 100)}%`;
  return `x ${pct(rect.x)}, y ${pct(rect.y)}, ${pct(rect.width)}×${pct(rect.height)}`;
}
