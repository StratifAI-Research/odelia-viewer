import createHeatmapImageSliceSynchronizer from './createHeatmapImageSliceSynchronizer';
import { SynchronizerManager } from '@cornerstonejs/tools';
// No VolumeViewport import: the implementation identifies a volume by getNumberOfSlices()
// disagreeing with getImageIds().length rather than by `instanceof`, so plain objects suffice
// and the doubles no longer have to be real instances to exercise the branch.
import { Enums, getRenderingEngine, metaData, utilities } from '@cornerstonejs/core';

describe('createHeatmapImageSliceSynchronizer', () => {
  beforeEach(() => {
    (SynchronizerManager.createSynchronizer as jest.Mock).mockClear();
  });

  it('returns the synchronizer produced by SynchronizerManager', () => {
    const sync = createHeatmapImageSliceSynchronizer('heatmap-sync');
    expect(sync).toBeDefined();
    expect(typeof (sync as any).destroy).toBe('function');
    expect(SynchronizerManager.createSynchronizer).toHaveBeenCalledTimes(1);
  });

  it('wires the STACK_NEW_IMAGE event and a callback', () => {
    createHeatmapImageSliceSynchronizer('heatmap-sync');
    const [name, event, callback] = (SynchronizerManager.createSynchronizer as jest.Mock).mock
      .calls[0];
    expect(name).toBe('heatmap-sync');
    expect(event).toBe(Enums.Events.STACK_NEW_IMAGE);
    expect(typeof callback).toBe('function');
  });

  it('registers a VOLUME_NEW_IMAGE auxiliary event on the element', () => {
    createHeatmapImageSliceSynchronizer('heatmap-sync');
    const options = (SynchronizerManager.createSynchronizer as jest.Mock).mock.calls[0][3];
    expect(options.auxiliaryEvents).toEqual([
      { name: Enums.Events.VOLUME_NEW_IMAGE, source: 'element' },
    ]);
  });

  it('forwards caller-supplied options into the synchronizer config', () => {
    createHeatmapImageSliceSynchronizer('heatmap-sync', { useInitialPosition: false });
    const options = (SynchronizerManager.createSynchronizer as jest.Mock).mock.calls[0][3];
    expect(options.useInitialPosition).toBe(false);
    // Custom options must not clobber the auxiliary-event wiring.
    expect(options.auxiliaryEvents).toHaveLength(1);
  });
});

// The callback is not exported, so it is taken from the createSynchronizer mock, which is
// where the production code hands it over.
describe('imageSliceSyncCallback slice selection', () => {
  // Geometry measured from the ODELIA study, including the part that makes this subtle:
  //
  //   MR   VolumeViewport  155 imageIds (31 slices x 5 temporal positions), 31 slices
  //   SC   StackViewport    31 imageIds
  //
  // The volume's SLICE index runs OPPOSITE to its own flat imageIds array. Slice 0 sits at
  // z = +55.75 while imageIds[0] sits at z = -43.24; they coincide only at the midpoint,
  // slice 15. So the correct target frame for source slice j is 30 - j, and a test whose
  // fake volume has slice index == array index cannot tell a correct implementation from one
  // that indexes the array (an earlier version of this test did exactly that, and passed
  // against code that read the mirrored position).
  const FOR = 'shared-frame-of-reference';
  const N = 31;
  const TEMPORAL = 5;
  const Z_FIRST = -43.242647;
  const Z_LAST = 55.754175;
  const zAsc = i => Z_FIRST + (i * (Z_LAST - Z_FIRST)) / (N - 1);

  // Ascending in z, like the acquisition order: [t1s0..t1s30, t2s0..t2s30, ...].
  const volumeImageIds = Array.from({ length: N * TEMPORAL }, (_, k) => `vol:${k % N}`);
  // Slice index -> imageId, descending in z: slice 0 is the LAST ascending position.
  const volumeSliceImageId = slice => `vol:${N - 1 - slice}`;

  const makeVolumeSource = sliceIndex => ({
    getCurrentImageIdIndex: jest.fn(() => sliceIndex),
    getCurrentImageId: jest.fn(() => volumeSliceImageId(sliceIndex)),
    getImageIds: jest.fn(() => volumeImageIds),
    getNumberOfSlices: jest.fn(() => N),
    getFrameOfReferenceUID: jest.fn(() => FOR),
    // -z, like the real MR. That is not incidental: a volume's slice index ascends with
    // projection along its OWN normal, so a viewport whose slice 0 sits at maximum z must have
    // a normal pointing the other way. Modelling +z here would describe a viewport cornerstone
    // never produces, and the earlier version of this double did exactly that.
    getCamera: jest.fn(() => ({ viewPlaneNormal: [0, 0, -1] })),
    element: { kind: 'volume' },
  });

  const makeStackTarget = currentIndex => ({
    getCurrentImageIdIndex: jest.fn(() => currentIndex),
    getCurrentImageId: jest.fn(() => `stack:${currentIndex}`),
    getImageIds: jest.fn(() => Array.from({ length: N }, (_, i) => `stack:${i}`)),
    getNumberOfSlices: jest.fn(() => N),
    getFrameOfReferenceUID: jest.fn(() => FOR),
    getCamera: jest.fn(() => ({ viewPlaneNormal: [0, 0, 1] })),
    element: { kind: 'stack' },
  });

  const run = async (source, target) => {
    (getRenderingEngine as jest.Mock).mockReturnValue({
      getViewport: (id: string) => (id === 'src' ? source : target),
    });
    (metaData.get as jest.Mock).mockImplementation((_m: string, imageId: string) => {
      const [, n] = String(imageId).split(':');
      return { imagePositionPatient: [0, 0, zAsc(Number(n))] };
    });
    const u = utilities as Record<string, unknown>;
    u.spatialRegistrationMetadataProvider = { get: jest.fn(() => undefined) };
    u.calculateViewportsSpatialRegistration = jest.fn();
    u.jumpToSlice = jest.fn();
    // The capability check the production code prefers. Modelled explicitly rather than left
    // to the count heuristic, because a real StackViewport also implements getNumberOfSlices
    // and the heuristic alone cannot tell a plain volume from a stack.
    u.viewportIsInVolumeMode = jest.fn((vp: any) =>
      String(vp?.element?.kind ?? '').startsWith('volume')
    );

    createHeatmapImageSliceSynchronizer('heatmap-sync');
    const callback = (SynchronizerManager.createSynchronizer as jest.Mock).mock.calls[0][2];
    await callback(
      { getOptions: () => ({}) },
      { renderingEngineId: 're', viewportId: 'src' },
      { renderingEngineId: 're', viewportId: 'tgt' }
    );
    return u.jumpToSlice as jest.Mock;
  };

  // 8 -> 22 is the pair measured in the browser: MR slice 8 and heatmap frame 22 are both
  // at z = 29.36.
  //
  // BOTH ENDS are pinned (0 -> 30 and 30 -> 0) as well as interior values. The ends are where
  // an off-by-one in the rank, or a clamp, shows up while every interior pair still looks
  // right; the midpoint is where a mirror hides. Between them the four interior pairs, the
  // midpoint case below, and these two endpoints leave no arrangement of
  // reverse/shift/clamp that satisfies the whole set but the correct mapping.
  it.each([
    [0, 30],
    [2, 28],
    [8, 22],
    [12, 18],
    [25, 5],
    [30, 0],
  ])('drives volume slice %i to the same-z stack frame %i', async (slice, expected) => {
    const jumpToSlice = await run(makeVolumeSource(slice), makeStackTarget(15));

    expect(jumpToSlice).toHaveBeenCalledWith({ kind: 'stack' }, { imageIndex: expected });
  });

  it('lands on the same index only at the midpoint, where the two axes cross', async () => {
    const jumpToSlice = await run(makeVolumeSource(15), makeStackTarget(0));

    expect(jumpToSlice).toHaveBeenCalledWith({ kind: 'stack' }, { imageIndex: 15 });
  });

  // The failure mode this guards: reading getImageIds()[getCurrentImageIdIndex()] instead of
  // getCurrentImageId() yields the mirrored position, which for slice 8 would move the stack
  // to frame 8 rather than 22.
  it('does not take the source position from the flat imageIds array', async () => {
    const jumpToSlice = await run(makeVolumeSource(8), makeStackTarget(0));

    expect(jumpToSlice).not.toHaveBeenCalledWith(expect.anything(), { imageIndex: 8 });
  });

  it('does nothing when the target is already on the matching frame', async () => {
    const jumpToSlice = await run(makeVolumeSource(8), makeStackTarget(22));

    expect(jumpToSlice).not.toHaveBeenCalled();
  });

  // A volume target gets a SLICE index resolved from world position, never the flat imageIds
  // index. The rank is taken in PROJECTION order along the target's own view normal, which is
  // what makes it direction-free -- there is no calibration step and no mirroring constant.
  // This target's normal is -z, so ascending projection is descending z: a source at
  // ascending-z rank 3 lands on slice 31-1-3 = 27.
  it('resolves a DYNAMIC volume target to a slice index, not a flat imageIds index', async () => {
    const volumeTarget = {
      ...makeVolumeSource(0),
      getImageIds: jest.fn(() => volumeImageIds),
      element: { kind: 'volume-dynamic-target' },
    };
    const jumpToSlice = await run(makeStackTarget(3), volumeTarget);

    expect(jumpToSlice).toHaveBeenCalledWith({ kind: 'volume-dynamic-target' }, { imageIndex: 27 });
    // 155 - 3 - 1 = 151 is what upstream's formula would give, and is out of range for 31 slices.
    expect(jumpToSlice).not.toHaveBeenCalledWith(expect.anything(), { imageIndex: 151 });
  });

  // The same end-pinning for the OTHER direction -- scrolling the heatmap to drive the MR.
  // This one is worth pinning independently: it goes through volumeSliceIndexFor rather than
  // the flat nearest-position search, so a defect on this side is invisible to the cases
  // above. (Frame 15 is deliberately absent: it is the midpoint, where a mirror cannot show.)
  it.each([
    [0, 30],
    [3, 27],
    [22, 8],
    [30, 0],
  ])('drives stack frame %i to the same-z volume slice %i', async (frame, expected) => {
    // Parked on slice 5, which is none of the expected answers: otherwise the
    // `alreadyAligned` short-circuit would satisfy the case without ever
    // resolving an index, and the endpoint pair (frame 30 -> slice 0) is exactly
    // where that happens with a target parked at 0.
    const volumeTarget = {
      ...makeVolumeSource(5),
      getImageIds: jest.fn(() => volumeImageIds),
      element: { kind: 'volume-dynamic-target' },
    };
    const jumpToSlice = await run(makeStackTarget(frame), volumeTarget);

    expect(jumpToSlice).toHaveBeenCalledWith(
      { kind: 'volume-dynamic-target' },
      { imageIndex: expected }
    );
  });

  /**
   * The round trip: forward then reverse must be the identity at every slice.
   *
   * Deliberately narrow about what this proves. It composes the implementation with itself,
   * so it establishes that the two directions are INVERSES of each other -- not that either
   * lands on the right slice. A mutually-inverse but wrong bijection (say, two adjacent
   * slices swapped in both directions) still round-trips cleanly. Same-position correctness
   * is what the two explicit tables above pin, at both ends and in both directions; this adds
   * the one property they cannot express, which is that sync does not walk the viewports
   * apart as the reader scrolls back and forth.
   */
  it.each([0, 1, 8, 15, 22, 29, 30])(
    'volume slice %i survives a round trip through the heatmap unchanged',
    async slice => {
      // Both viewports start where they cannot already be right for any slice in
      // the table (frames 3 and 5 are outside {30,29,22,15,8,1,0}), so every case
      // actually resolves an index rather than short-circuiting on alreadyAligned.
      const toStack = await run(makeVolumeSource(slice), makeStackTarget(3));
      const [, { imageIndex: frame }] = toStack.mock.calls.at(-1);

      const volumeTarget = {
        ...makeVolumeSource(5),
        getImageIds: jest.fn(() => volumeImageIds),
        element: { kind: 'volume-dynamic-target' },
      };
      const backToVolume = await run(makeStackTarget(frame), volumeTarget);

      expect(backToVolume).toHaveBeenCalledWith(
        { kind: 'volume-dynamic-target' },
        { imageIndex: slice }
      );
    }
  );

  // The case the count heuristic could NOT see: a plain volume reports slices === imageIds, so
  // it used to fall through as a stack and receive the flat index. This one is showing slice 0
  // at the FIRST ascending position, so its axis calibrates as ascending.
  it('resolves a PLAIN volume target, whose slice and image counts are equal', async () => {
    const plainVolumeTarget = {
      getCurrentImageIdIndex: jest.fn(() => 0),
      getCurrentImageId: jest.fn(() => 'stack:0'),
      getImageIds: jest.fn(() => Array.from({ length: N }, (_, i) => `stack:${i}`)),
      getNumberOfSlices: jest.fn(() => N),
      getFrameOfReferenceUID: jest.fn(() => FOR),
      getCamera: jest.fn(() => ({ viewPlaneNormal: [0, 0, 1] })),
      element: { kind: 'volume-plain-target' },
    };
    // Source slice 8 sits at ascending rank 22; an ascending target therefore wants slice 22.
    const jumpToSlice = await run(makeVolumeSource(8), plainVolumeTarget);

    expect(jumpToSlice).toHaveBeenCalledWith({ kind: 'volume-plain-target' }, { imageIndex: 22 });
  });

  it('refuses a volume target whose distinct positions do not match its slice count', async () => {
    const inconsistent = {
      ...makeVolumeSource(0),
      getImageIds: jest.fn(() => volumeImageIds),
      getNumberOfSlices: jest.fn(() => 7),
      element: { kind: 'volume-inconsistent' },
    };
    const jumpToSlice = await run(makeStackTarget(3), inconsistent);

    expect(jumpToSlice).not.toHaveBeenCalled();
  });

  it('refuses when a viewport cannot report a view-plane normal', async () => {
    const blindTarget = { ...makeStackTarget(0), getCamera: jest.fn(() => ({})) };
    const jumpToSlice = await run(makeVolumeSource(8), blindTarget);

    expect(jumpToSlice).not.toHaveBeenCalled();
  });

  it('refuses non-coplanar viewports', async () => {
    const sagittal = {
      ...makeStackTarget(0),
      getCamera: jest.fn(() => ({ viewPlaneNormal: [1, 0, 0] })),
    };
    const jumpToSlice = await run(makeVolumeSource(8), sagittal);

    expect(jumpToSlice).not.toHaveBeenCalled();
  });

  it('refuses when the two viewports report no Frame of Reference', async () => {
    const source = { ...makeVolumeSource(8), getFrameOfReferenceUID: jest.fn(() => '') };
    const target = { ...makeStackTarget(0), getFrameOfReferenceUID: jest.fn(() => '') };
    const jumpToSlice = await run(source, target);

    // Two MISSING UIDs compare equal; that must not be read as "same frame of reference".
    expect(jumpToSlice).not.toHaveBeenCalled();
  });

  it('does not jump when no target slice has a usable position', async () => {
    const source = makeVolumeSource(8);
    const target = makeStackTarget(0);
    (getRenderingEngine as jest.Mock).mockReturnValue({
      getViewport: (id: string) => (id === 'src' ? source : target),
    });
    const u = utilities as Record<string, unknown>;
    u.spatialRegistrationMetadataProvider = { get: jest.fn(() => undefined) };
    u.jumpToSlice = jest.fn();
    u.viewportIsInVolumeMode = jest.fn(() => false);
    (metaData.get as jest.Mock).mockImplementation((_m: string, imageId: string) =>
      String(imageId).startsWith('vol:')
        ? { imagePositionPatient: [0, 0, 0] }
        : { imagePositionPatient: undefined }
    );

    createHeatmapImageSliceSynchronizer('heatmap-sync');
    const callback = (SynchronizerManager.createSynchronizer as jest.Mock).mock.calls[0][2];
    await callback(
      { getOptions: () => ({}) },
      { renderingEngineId: 're', viewportId: 'src' },
      { renderingEngineId: 're', viewportId: 'tgt' }
    );

    expect(u.jumpToSlice).not.toHaveBeenCalled();
  });
});
