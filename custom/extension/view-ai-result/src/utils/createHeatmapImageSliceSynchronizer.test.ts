import createHeatmapImageSliceSynchronizer from './createHeatmapImageSliceSynchronizer';
import { SynchronizerManager } from '@cornerstonejs/tools';
import {
  Enums,
  getRenderingEngine,
  metaData,
  utilities,
  VolumeViewport,
} from '@cornerstonejs/core';

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
    element: { kind: 'volume' },
  });

  const makeStackTarget = currentIndex => ({
    getCurrentImageIdIndex: jest.fn(() => currentIndex),
    getCurrentImageId: jest.fn(() => `stack:${currentIndex}`),
    getImageIds: jest.fn(() => Array.from({ length: N }, (_, i) => `stack:${i}`)),
    getNumberOfSlices: jest.fn(() => N),
    getFrameOfReferenceUID: jest.fn(() => FOR),
    element: { kind: 'stack' },
  });

  const run = async (source, target) => {
    const cs = jest.requireMock('@cornerstonejs/core');
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
  it.each([
    [8, 22],
    [12, 18],
    [25, 5],
    [2, 28],
  ])('drives volume slice %i to the same-z stack frame %i', async (slice, expected) => {
    const jumpToSlice = await run(makeVolumeSource(slice), makeStackTarget(0));

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

  // A volume TARGET would need a slice index, but the spatial search yields a flat imageIds
  // index -- 155 entries against 31 slices, in the opposite direction. Declining beats
  // jumping the reader to an unrelated slice.
  it('declines a volume target rather than passing it a flat imageIds index', async () => {
    const volumeTarget = {
      ...makeVolumeSource(0),
      getImageIds: jest.fn(() => volumeImageIds),
      element: { kind: 'volumeTarget' },
    };
    const jumpToSlice = await run(makeStackTarget(3), volumeTarget);

    expect(jumpToSlice).not.toHaveBeenCalled();
  });
});
