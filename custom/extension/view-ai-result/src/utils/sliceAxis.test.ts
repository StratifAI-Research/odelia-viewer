import {
  canAddressAxis,
  formatAxisShape,
  formatDimensionGroup,
  dimensionGroupCount,
  dimensionGroupInstances,
  positionOf,
  sliceAxisOf,
} from './sliceAxis';
// Jest-only mock helpers; the alias is invisible to tsc, hence the path.
import { __resetMetaData, __setMetaData } from '../test-utils/__mocks__/cornerstone-core';

const uid = (n: number) => `1.2.840.SE1.${n}`;

/** Seed cornerstone metadata for `imageId -> SOPInstanceUID`, as a loader would. */
function seed(pairs: Array<[string, number]>) {
  pairs.forEach(([imageId, n]) =>
    __setMetaData('generalImageModule', imageId, { sopInstanceUID: uid(n) })
  );
}

/**
 * A 4D display set shaped like the real UKA dynamic series: `slices` anatomical
 * positions × `phases` contrast phases, split by TemporalPositionIdentifier.
 *
 * Instance numbering follows the real data: `timePoints[t][i]` is the image at
 * anatomical slice i of phase t.
 */
function dynamicDisplaySet(slices: number, phases: number) {
  const timePoints: string[][] = [];
  for (let t = 0; t < phases; t++) {
    const ids: string[] = [];
    for (let i = 0; i < slices; i++) {
      const imageId = `img-t${t}-s${i}`;
      ids.push(imageId);
      seed([[imageId, t * slices + i + 1]]);
    }
    timePoints.push(ids);
  }
  return {
    numImageFrames: slices * phases,
    // Deliberately NOT in slice order, and interleaved by phase — this is what
    // the display set really holds, and reading it as the axis is the bug.
    images: Array.from({ length: slices * phases }, (_, i) => ({ SOPInstanceUID: uid(i + 1) })),
    dynamicVolumeInfo: {
      isDynamicVolume: true,
      timePoints,
      splittingTag: 'TemporalPositionIdentifier',
    },
  };
}

beforeEach(() => __resetMetaData());

describe('sliceAxisOf — an ordinary series', () => {
  it('is the instance list, in display-set order', () => {
    const axis = sliceAxisOf({ images: [{ SOPInstanceUID: 'a' }, { SOPInstanceUID: 'b' }] });
    expect(axis.sliceCount).toBe(2);
    expect(axis.dimensionGroups).toEqual([['a', 'b']]);
    expect(dimensionGroupCount(axis)).toBe(1);
    expect(axis.splittingTag).toBeUndefined();
  });

  it('accepts the `instances` spelling too', () => {
    expect(sliceAxisOf({ instances: [{ SOPInstanceUID: 'a' }] }).sliceCount).toBe(1);
  });

  it('refuses a list with any instance missing its UID', () => {
    // A partial mapping would shift every slice number after the gap, so the
    // panel must fall back to the middleware's recipe rather than half-address.
    const axis = sliceAxisOf({ images: [{ SOPInstanceUID: 'a' }, {}] });
    expect(axis.sliceCount).toBe(0);
    expect(axis.dimensionGroups).toEqual([[]]);
  });

  it('is empty for a display set with no instances at all', () => {
    expect(sliceAxisOf({}).sliceCount).toBe(0);
    expect(sliceAxisOf(null).sliceCount).toBe(0);
  });
});

describe('sliceAxisOf — a 4D dynamic series', () => {
  it('is the anatomical axis, not the instance count', () => {
    // The real proportions: 155 instances that the viewer scrolls as 31 slices.
    const axis = sliceAxisOf(dynamicDisplaySet(31, 5));
    expect(axis.sliceCount).toBe(31);
    expect(dimensionGroupCount(axis)).toBe(5);
    expect(axis.splittingTag).toBe('TemporalPositionIdentifier');
  });

  it('keeps each group in the viewer’s own slice order', () => {
    const axis = sliceAxisOf(dynamicDisplaySet(3, 2));
    expect(axis.dimensionGroups[0]).toEqual([uid(1), uid(2), uid(3)]);
    expect(axis.dimensionGroups[1]).toEqual([uid(4), uid(5), uid(6)]);
  });

  it('does not read the interleaved instance list as the axis', () => {
    // `images` is 6 long and ordered by neither slice nor phase. Reading it as
    // the axis is precisely the bug: it offers "6 slices" for 3 anatomical
    // positions, and a sample across it straddles contrast phases.
    const ds = dynamicDisplaySet(3, 2);
    expect(ds.images).toHaveLength(6);
    expect(sliceAxisOf(ds).sliceCount).toBe(3);
  });

  it('refuses the axis when a group has an unresolvable instance', () => {
    // All-or-nothing, for the same reason a partial instance list is refused.
    const ds = dynamicDisplaySet(3, 2);
    __resetMetaData();
    seed([
      ['img-t0-s0', 1],
      ['img-t0-s1', 2],
    ]);
    expect(sliceAxisOf(ds).sliceCount).toBe(0);
  });

  it('refuses the axis when groups have different lengths', () => {
    const ds = dynamicDisplaySet(3, 2);
    ds.dynamicVolumeInfo.timePoints[1] = ds.dynamicVolumeInfo.timePoints[1].slice(0, 2);
    expect(sliceAxisOf(ds).sliceCount).toBe(0);
  });

  it('falls through to the instance list when the flag is off', () => {
    const ds: any = dynamicDisplaySet(3, 2);
    ds.dynamicVolumeInfo.isDynamicVolume = false;
    expect(sliceAxisOf(ds).sliceCount).toBe(6);
  });
});

describe('dimensionGroupInstances', () => {
  it('returns the chosen group', () => {
    const axis = sliceAxisOf(dynamicDisplaySet(3, 2));
    expect(dimensionGroupInstances(axis, 1)).toEqual([uid(4), uid(5), uid(6)]);
  });

  it('clamps out-of-range groups rather than returning nothing', () => {
    // A display set can be replaced in place by one with fewer groups; sending
    // no slices at all would be a worse answer than sending the last group.
    const axis = sliceAxisOf(dynamicDisplaySet(3, 2));
    expect(dimensionGroupInstances(axis, 9)).toEqual(dimensionGroupInstances(axis, 1));
    expect(dimensionGroupInstances(axis, -1)).toEqual(dimensionGroupInstances(axis, 0));
  });
});

describe('positionOf', () => {
  it('finds both the group and the slice of an instance', () => {
    const axis = sliceAxisOf(dynamicDisplaySet(3, 2));
    expect(positionOf(axis, uid(5))).toEqual({ groupIndex: 1, sliceNumber: 2 });
    expect(positionOf(axis, uid(1))).toEqual({ groupIndex: 0, sliceNumber: 1 });
  });

  it('is null for an instance that is not on this axis', () => {
    const axis = sliceAxisOf(dynamicDisplaySet(3, 2));
    expect(positionOf(axis, 'someone-elses-instance')).toBeNull();
    expect(positionOf(axis, null)).toBeNull();
    expect(positionOf(axis, undefined)).toBeNull();
  });
});

describe('canAddressAxis', () => {
  it('accounts for every frame the viewer holds', () => {
    const axis = sliceAxisOf(dynamicDisplaySet(31, 5));
    expect(canAddressAxis(axis, 155)).toBe(true);
    // 31 slices cannot explain 160 frames: something is unaccounted for, and
    // naming slices would address the wrong pixels.
    expect(canAddressAxis(axis, 160)).toBe(false);
  });

  it('reduces to one-instance-per-slice for an ordinary series', () => {
    const axis = sliceAxisOf({ images: [{ SOPInstanceUID: 'a' }, { SOPInstanceUID: 'b' }] });
    expect(canAddressAxis(axis, 2)).toBe(true);
    // A multi-frame instance: one UID, many slices. A range cannot name it.
    expect(canAddressAxis(axis, 60)).toBe(false);
  });

  it('is false for an empty axis', () => {
    expect(canAddressAxis(sliceAxisOf({}), 0)).toBe(false);
  });
});

describe('labels', () => {
  it('names a group 1-based, as the cine bar does, and after its own tag', () => {
    expect(formatDimensionGroup(0, 5, 'TemporalPositionIdentifier')).toBe(
      'temporal position 1 of 5'
    );
    expect(formatDimensionGroup(4, 5, 'TemporalPositionIdentifier')).toBe(
      'temporal position 5 of 5'
    );
  });

  it('never calls anything a contrast phase', () => {
    // Cornerstone splits a 4D series on whichever of several tags separates it,
    // and not one of them asserts contrast: even TemporalPositionIdentifier is
    // only temporal order. A provenance line that called a b-value, or a
    // non-contrast dynamic series, a phase would be asserting a clinical fact
    // about the images that nothing in them supports.
    expect(formatDimensionGroup(1, 4, 'DiffusionBValue')).toBe('b-value 2 of 4');
    expect(formatDimensionGroup(1, 4, 'SiemensPrivateBValue')).toBe('b-value 2 of 4');
    expect(formatDimensionGroup(0, 3, 'EchoTime')).toBe('echo 1 of 3');
    // "echos" is what a bare +s gives, and it is not a word.
    expect(
      formatAxisShape({ sliceCount: 4, dimensionGroups: [[], [], []], splittingTag: 'EchoTime' })
    ).toBe('4 slices × 3 echoes');
    expect(formatDimensionGroup(0, 3, 'TriggerTime')).toBe('trigger time 1 of 3');
    expect(formatDimensionGroup(0, 3, 'PetFrameReferenceTime')).toBe('frame time 1 of 3');
  });

  it('stays neutral for a tag it does not know', () => {
    // Borrowing a word from a different acquisition would be worse than a plain
    // one: "group" claims nothing.
    expect(formatDimensionGroup(0, 2, 'SomethingNew')).toBe('group 1 of 2');
    expect(formatDimensionGroup(0, 2, undefined)).toBe('group 1 of 2');
  });

  it('describes the shape of the axis', () => {
    expect(formatAxisShape(sliceAxisOf(dynamicDisplaySet(31, 5)))).toBe(
      '31 slices × 5 temporal positions'
    );
    expect(formatAxisShape(sliceAxisOf({ images: [{ SOPInstanceUID: 'a' }] }))).toBe('1 slice');
  });
});
