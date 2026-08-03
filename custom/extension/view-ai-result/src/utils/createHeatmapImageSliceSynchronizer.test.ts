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
  // Geometry from the ODELIA study this synchronizer exists for: an MR volume of 31 slices
  // per temporal position and a 31-frame SC heatmap, both ascending in z over the same
  // range with a shared Frame of Reference.
  const FOR = 'shared-frame-of-reference';
  const N = 31;
  // Measured endpoints of both series; the step is derived rather than written out, which
  // also keeps it clear of no-loss-of-precision.
  const Z_FIRST = -43.242647;
  const Z_LAST = 55.754175;
  const zAt = (i: number) => Z_FIRST + (i * (Z_LAST - Z_FIRST)) / (N - 1);

  // The source MUST be a real VolumeViewport instance: the reversal this guards against was
  // gated on `sViewport instanceof VolumeViewport`, so a plain object silently skips the
  // branch and the test would pass either way. (It did, until this was fixed.)
  const makeViewport = (kind: 'volume' | 'stack', currentIndex: number) =>
    // The jest mock's VolumeViewport is a bare `class {}`; the published typings declare a
    // constructor argument, so cast to construct it the way the mock actually is.
    Object.assign(kind === 'volume' ? new (VolumeViewport as unknown as new () => object)() : {}, {
      getCurrentImageIdIndex: jest.fn(() => currentIndex),
      getImageIds: jest.fn(() => Array.from({ length: N }, (_, i) => `${kind}:${i}`)),
      getFrameOfReferenceUID: jest.fn(() => FOR),
      element: { kind },
    });

  const run = async (sourceIndex: number) => {
    const source = makeViewport('volume', sourceIndex);
    const target = makeViewport('stack', 0);

    (getRenderingEngine as jest.Mock).mockReturnValue({
      getViewport: (id: string) => (id === 'src' ? source : target),
    });
    (metaData.get as jest.Mock).mockImplementation((_module: string, imageId: string) => ({
      imagePositionPatient: [0, 0, zAt(Number(String(imageId).split(':')[1]))],
    }));
    // The shared core mock carries only imageIdToURI; add what this code path uses.
    // Reporting no stored registration while both viewports share a Frame of Reference
    // makes the production code fall back to an identity matrix -- source position ==
    // target position, which is the real geometry of these two series.
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

  // Regression: the volume->stack branch used to set `targetImageIds.length - index - 1`,
  // mirroring the heatmap against the anatomy. Both stacks ascend in z here, so the
  // spatial match must be used as-is. 12 -> 18 and 25 -> 5 were the observed failures.
  it.each([
    [12, 12],
    [25, 25],
    [5, 5],
    [0, 0],
    [N - 1, N - 1],
  ])('drives a volume source at index %i to the same-z stack slice %i', async (from, expected) => {
    const jumpToSlice = await run(from);

    expect(jumpToSlice).toHaveBeenCalledTimes(expected === 0 ? 0 : 1);
    if (expected !== 0) {
      expect(jumpToSlice).toHaveBeenCalledWith({ kind: 'stack' }, { imageIndex: expected });
    }
  });

  it('does not mirror the index (the reversal would give 31 - i - 1)', async () => {
    const jumpToSlice = await run(12);

    expect(jumpToSlice).not.toHaveBeenCalledWith(expect.anything(), { imageIndex: N - 12 - 1 });
  });
});
