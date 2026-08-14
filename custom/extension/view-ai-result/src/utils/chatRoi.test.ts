import {
  formatRoiLabel,
  formatRoiRect,
  formatRoiScope,
  slicesForRoi,
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

describe('slicesForRoi', () => {
  it('sends only the slice the region was drawn on by default', () => {
    expect(slicesForRoi('slice', 27, [10, 20, 30, 40])).toEqual([27]);
  });

  it('applies the region across the sampled range when asked', () => {
    expect(slicesForRoi('range', 27, [10, 20, 30, 40])).toEqual([10, 20, 30, 40]);
  });

  it('keeps a region drawn outside the selected range', () => {
    // The user drew it deliberately; dropping it would send the uncropped range
    // instead while the panel still showed a region attached.
    expect(slicesForRoi('slice', 99, [10, 20])).toEqual([99]);
  });

  it('sends nothing under range scope when the range samples nothing', () => {
    expect(slicesForRoi('range', 27, [])).toEqual([]);
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
