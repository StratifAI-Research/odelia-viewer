import {
  formatRoiLabel,
  formatRoiRect,
  formatRoiScope,
  isPointInsideCorners,
  toFractionalRect,
} from './chatRoi';

describe('toFractionalRect', () => {
  it('converts image pixels into fractions of the image', () => {
    const rect = toFractionalRect(
      [
        [100, 50],
        [300, 50],
        [300, 250],
        [100, 250],
      ],
      400,
      500
    );
    expect(rect).toEqual({ x: 0.25, y: 0.1, width: 0.5, height: 0.4 });
  });

  it('does not care which corner was dragged from', () => {
    // Cornerstone reports the handles in drag order, so a bottom-right-to-top-left
    // drag arrives with the corners reversed.
    const forwards = toFractionalRect(
      [
        [100, 50],
        [300, 250],
      ],
      400,
      500
    );
    const backwards = toFractionalRect(
      [
        [300, 250],
        [100, 50],
      ],
      400,
      500
    );
    expect(backwards).toEqual(forwards);
  });

  it('clamps a drag that ran off the edge of the image', () => {
    // The middleware rejects a rectangle that does not fit inside the image.
    const rect = toFractionalRect(
      [
        [-40, -30],
        [500, 700],
      ],
      400,
      500
    );
    expect(rect).toEqual({ x: 0, y: 0, width: 1, height: 1 });
  });

  it('rejects a click that was never dragged', () => {
    // A sliver of nothing would still be cropped and sent, as though it were the
    // region asked about.
    expect(toFractionalRect([[100, 100]], 400, 500)).toBeNull();
    expect(
      toFractionalRect(
        [
          [100, 100],
          [101, 101],
        ],
        400,
        500
      )
    ).toBeNull();
  });

  it('accepts a small but deliberate drag', () => {
    const rect = toFractionalRect(
      [
        [100, 100],
        [110, 110],
      ],
      400,
      500
    );
    expect(rect).not.toBeNull();
    expect(rect?.width).toBeCloseTo(10 / 400);
  });

  it('returns null when the image size is unknown', () => {
    expect(
      toFractionalRect(
        [
          [10, 10],
          [90, 90],
        ],
        0,
        0
      )
    ).toBeNull();
  });

  it('returns null for no points at all', () => {
    expect(toFractionalRect([], 400, 500)).toBeNull();
  });

  it('ignores a point cornerstone could not resolve', () => {
    const rect = toFractionalRect(
      [
        [100, 50],
        [NaN, NaN],
        [300, 250],
      ],
      400,
      500
    );
    expect(rect).toEqual({ x: 0.25, y: 0.1, width: 0.5, height: 0.4 });
  });

  it('handles a non-square image without mixing the axes', () => {
    // Swapping rows and columns is the classic way to crop the wrong region.
    const rect = toFractionalRect(
      [
        [0, 0],
        [100, 100],
      ],
      200,
      400
    );
    expect(rect).toEqual({ x: 0, y: 0, width: 0.5, height: 0.25 });
  });
});

describe('isPointInsideCorners', () => {
  const A = [100, 50];
  const B = [300, 250];

  it('accepts a point in the middle of the rectangle', () => {
    // The whole reason this exists: cornerstone's own hit test only reaches a
    // few pixels around the outline, so the obvious drag lands on window/level.
    expect(isPointInsideCorners([200, 150], A, B)).toBe(true);
  });

  it('accepts a point on the edge', () => {
    expect(isPointInsideCorners([100, 150], A, B)).toBe(true);
  });

  it('rejects a point outside on either axis', () => {
    expect(isPointInsideCorners([99, 150], A, B)).toBe(false);
    expect(isPointInsideCorners([200, 251], A, B)).toBe(false);
  });

  it('does not care which diagonal the corners describe', () => {
    // A rectangle can be dragged out in any direction, so neither corner is
    // reliably the top-left one.
    expect(isPointInsideCorners([200, 150], B, A)).toBe(true);
    expect(isPointInsideCorners([200, 150], [300, 50], [100, 250])).toBe(true);
  });

  it('rejects a point it cannot place', () => {
    // Answering "yes" for a point we cannot locate would swallow a window/level
    // drag with nothing to show for it.
    expect(isPointInsideCorners([NaN, 150], A, B)).toBe(false);
    expect(isPointInsideCorners([200, 150], [undefined as never, 50], B)).toBe(false);
    expect(isPointInsideCorners([], A, B)).toBe(false);
  });
});

describe('formatting', () => {
  it('labels the chip with the slice the region belongs to', () => {
    expect(formatRoiLabel(27)).toBe('ROI · slice 27');
  });

  it('names both scopes', () => {
    expect(formatRoiScope('slice')).toBe('Current slice');
    expect(formatRoiScope('range')).toBe('Selected slice range');
  });

  it('describes the rectangle in percentages', () => {
    expect(formatRoiRect({ x: 0.24, y: 0.31, width: 0.18, height: 0.22 })).toBe(
      'x 24%, y 31%, 18%×22%'
    );
  });
});
