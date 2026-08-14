/**
 * The chat panel's region of interest: turning a drawn rectangle into something
 * the middleware can crop with, and deciding which slices it covers.
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

/** Which slices a region of interest applies to. */
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
 * The slices a region of interest actually applies to.
 *
 * `slice` — the default — sends only the slice the region was drawn on. It is
 * the unambiguous reading of "this region": one image, cropped to what the user
 * outlined. `range` applies the same crop to every slice the range samples,
 * which is useful for following a structure through the volume but means the
 * rectangle is being applied to slices it was not drawn on.
 *
 * A region drawn on a slice outside the selected range still governs under
 * `slice` scope: the user drew it deliberately, and silently dropping it would
 * send the uncropped range instead while the panel showed a region attached.
 */
export function slicesForRoi(
  scope: RoiScope,
  roiSliceNumber: number,
  sampledSliceNumbers: number[]
): number[] {
  if (scope === 'slice') {
    return [roiSliceNumber];
  }
  return sampledSliceNumbers;
}

/** `ROI · slice 27` — the attachment chip's label. */
export function formatRoiLabel(sliceNumber: number): string {
  return `ROI · slice ${sliceNumber}`;
}

/** Human name for a scope, for the "Apply ROI to" control. */
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
