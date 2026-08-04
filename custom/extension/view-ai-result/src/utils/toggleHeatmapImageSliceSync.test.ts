import alignHeatmapSlice from './alignHeatmapSlice';
import {
  toggleHeatmapImageSliceSync,
  ensureHeatmapImageSliceSync,
  isHeatmapSyncEnabled,
  isHeatmapSyncComplete,
  isHeatmapSyncUserDisabled,
  resetHeatmapSyncPreference,
} from './toggleHeatmapImageSliceSync';

// The alignment itself is covered by createHeatmapImageSliceSynchronizer.test.ts against real
// geometry; here only whether enabling triggers it, and what happens when it fails, matter.
jest.mock('./alignHeatmapSlice', () =>
  jest.fn(async () => ({ status: 'aligned', imageIndex: 22 }))
);

const HEATMAP_SYNC_ID = 'HEATMAP_IMAGE_SLICE_SYNC';

const makeServices = (
  opts: {
    hasSync?: boolean;
    viewportIds?: string[];
    missing?: string[];
    /** Whether the display sets carry a DICOM reference linking them. Default: they do. */
    paired?: boolean;
    activeViewportId?: string;
    /** Explicit per-viewport sync membership, for describing a HALF-BUILT group. */
    syncedIds?: string[];
    /** Viewport ids that carry an unrelated display set (no DICOM link to the pair). */
    unrelated?: string[];
    /** Reference the primary's Nth SOP instance rather than its first. */
    referenceIndex?: number;
  } = {}
) => {
  const viewportIds = opts.viewportIds ?? ['v1', 'v2'];
  const missing = new Set(opts.missing ?? []);
  const paired = opts.paired !== false;

  const viewports = new Map<string, any>();
  viewportIds.forEach(id =>
    viewports.set(id, {
      displaySetInstanceUIDs: [`ds-${id}`],
      viewportOptions: { viewportId: id },
    })
  );

  // The first viewport is the primary series; every other one references it, which is how the
  // real heatmap points at the MR (its ReferencedImageSequence names an MR SOP instance).
  const primary = viewportIds[0];
  const unrelated = new Set(opts.unrelated ?? []);
  // The primary owns several instances, like the real MR's 155. The heatmap references one of
  // them -- by default the last, mirroring the study where the reference is instance 154, so a
  // test cannot pass by only ever matching the first.
  const primaryInstances = ['sop-a', 'sop-b', 'sop-c'];
  const referenced = primaryInstances[opts.referenceIndex ?? primaryInstances.length - 1];
  const getDisplaySetByUID = jest.fn((uid: string) => {
    const id = String(uid).replace(/^ds-/, '');
    if (id === primary) {
      return {
        Modality: 'MR',
        instance: { SOPInstanceUID: primaryInstances[0] },
        instances: primaryInstances.map(SOPInstanceUID => ({ SOPInstanceUID })),
      };
    }
    if (unrelated.has(id)) {
      return { Modality: 'MR', instance: { SOPInstanceUID: `other-${id}` } };
    }
    const instance: any = { SOPInstanceUID: `sop-${id}` };
    if (paired) {
      instance.ReferencedImageSequence = [{ ReferencedSOPInstanceUID: referenced }];
    }
    return { Modality: 'SC', instance };
  });

  const syncedIds = opts.syncedIds ? new Set(opts.syncedIds) : undefined;
  const addViewportToSyncGroup = jest.fn();
  const removeViewportFromSyncGroup = jest.fn();
  const getSynchronizersForViewport = jest.fn((id: string) =>
    (syncedIds ? syncedIds.has(id) : opts.hasSync)
      ? [{ id: HEATMAP_SYNC_ID }]
      : [{ id: 'something-else' }]
  );

  const getCornerstoneViewport = jest.fn((id: string) =>
    missing.has(id)
      ? undefined
      : {
          getRenderingEngine: () => ({ id: `engine-${id}` }),
          getCurrentImageIdIndex: () => 0,
          getCurrentImageId: () => `${id}:0`,
          getImageIds: () => ['a', 'b'],
          getFrameOfReferenceUID: () => 'FOR',
          getCamera: () => ({ viewPlaneNormal: [0, 0, 1] }),
          element: { id },
        }
  );

  const servicesManager = {
    services: {
      syncGroupService: {
        addViewportToSyncGroup,
        removeViewportFromSyncGroup,
        getSynchronizersForViewport,
      },
      cornerstoneViewportService: { getCornerstoneViewport },
      displaySetService: { getDisplaySetByUID },
      viewportGridService: {
        getState: () => ({
          viewports,
          activeViewportId: opts.activeViewportId ?? viewportIds[0],
        }),
      },
    },
  };

  return {
    servicesManager,
    addViewportToSyncGroup,
    removeViewportFromSyncGroup,
    getCornerstoneViewport,
  };
};

beforeEach(() => {
  (alignHeatmapSlice as jest.Mock).mockClear();
  (alignHeatmapSlice as jest.Mock).mockImplementation(async () => ({
    status: 'aligned',
    imageIndex: 22,
  }));
});

describe('resolveSyncPair', () => {
  it('adds exactly the pair, as both source and target', async () => {
    const { servicesManager, addViewportToSyncGroup } = makeServices();

    await toggleHeatmapImageSliceSync({ servicesManager });

    // Bidirectional: scrolling either viewport drives the other. This was briefly one-way
    // while a volume target was refused, since advertising a reverse direction that silently
    // did nothing was worse than not offering it.
    expect(addViewportToSyncGroup).toHaveBeenCalledTimes(2);
    const roles = { type: 'heatmapImageSlice', id: HEATMAP_SYNC_ID, source: true, target: true };
    expect(addViewportToSyncGroup).toHaveBeenCalledWith('v1', 'engine-v1', roles);
    expect(addViewportToSyncGroup).toHaveBeenCalledWith('v2', 'engine-v2', roles);
  });

  // The old gate asked whether ANY two viewports were linked and then added EVERY populated
  // viewport, so one valid pair dragged an unrelated third viewport into the group.
  it('does not drag an unrelated third viewport into the group', async () => {
    const { servicesManager, addViewportToSyncGroup } = makeServices({
      viewportIds: ['v1', 'v2', 'v3'],
      unrelated: ['v3'],
    });

    await ensureHeatmapImageSliceSync({ servicesManager });

    expect(addViewportToSyncGroup).toHaveBeenCalledTimes(2);
    const ids = addViewportToSyncGroup.mock.calls.map(c => c[0]);
    expect(ids).toEqual(expect.arrayContaining(['v1', 'v2']));
    expect(ids).not.toContain('v3');
  });

  it('resolves a heatmap that references a non-first instance of the primary', async () => {
    const { servicesManager, addViewportToSyncGroup } = makeServices({ referenceIndex: 2 });

    await ensureHeatmapImageSliceSync({ servicesManager });

    expect(addViewportToSyncGroup).toHaveBeenCalledTimes(2);
  });

  it('aligns primary -> heatmap regardless of which viewport is active', async () => {
    const { servicesManager } = makeServices({ activeViewportId: 'v2' });

    await toggleHeatmapImageSliceSync({ servicesManager });

    expect(alignHeatmapSlice).toHaveBeenCalledTimes(1);
    expect(alignHeatmapSlice).toHaveBeenCalledWith(
      expect.objectContaining({ element: { id: 'v1' } }),
      expect.objectContaining({ element: { id: 'v2' } }),
      expect.objectContaining({ sourceViewportId: 'v1', targetViewportId: 'v2' })
    );
  });

  it('needs exactly one side of the pair to be the AI result', async () => {
    // Two plain series that reference each other are linked, but neither is a result.
    const { servicesManager, addViewportToSyncGroup } = makeServices({
      viewportIds: ['v1', 'v2'],
      unrelated: ['v2'],
    });

    await ensureHeatmapImageSliceSync({ servicesManager });

    expect(addViewportToSyncGroup).not.toHaveBeenCalled();
  });

  it('leaves unrelated display sets alone even when one is an SC', async () => {
    const { servicesManager, addViewportToSyncGroup } = makeServices({ paired: false });

    await ensureHeatmapImageSliceSync({ servicesManager });

    expect(addViewportToSyncGroup).not.toHaveBeenCalled();
  });
});

describe('nothing is installed unless the alignment succeeded', () => {
  // Order is the fix: preflight and ALIGN first, install membership last. The previous version
  // added everything and then aligned, so a refusal left a group that reported complete but
  // was not aligned -- and the automatic path, seeing "complete", never retried it.
  it.each([
    ['unsupported', { status: 'unsupported', reason: 'not coplanar' }],
    ['failed', { status: 'failed', reason: 'no registration' }],
  ])('adds nothing when alignment reports %s', async (_label, outcome) => {
    (alignHeatmapSlice as jest.Mock).mockResolvedValueOnce(outcome);
    const { servicesManager, addViewportToSyncGroup, removeViewportFromSyncGroup } = makeServices();

    await toggleHeatmapImageSliceSync({ servicesManager });

    expect(addViewportToSyncGroup).not.toHaveBeenCalled();
    // And nothing is removed either, so pre-existing membership is untouched.
    expect(removeViewportFromSyncGroup).not.toHaveBeenCalled();
  });

  it('installs membership when the viewports were already aligned', async () => {
    (alignHeatmapSlice as jest.Mock).mockResolvedValueOnce({ status: 'alreadyAligned' });
    const { servicesManager, addViewportToSyncGroup } = makeServices();

    await toggleHeatmapImageSliceSync({ servicesManager });

    // "Already in the right place" is success, not failure -- the distinction the old
    // null-return could not express.
    expect(addViewportToSyncGroup).toHaveBeenCalledTimes(2);
  });

  it('adds nothing when either side of the pair is not renderable yet', async () => {
    const { servicesManager, addViewportToSyncGroup } = makeServices({ missing: ['v2'] });

    await toggleHeatmapImageSliceSync({ servicesManager });

    expect(addViewportToSyncGroup).not.toHaveBeenCalled();
    expect(alignHeatmapSlice).not.toHaveBeenCalled();
  });
});

describe('ensureHeatmapImageSliceSync', () => {
  it('enables sync once the heatmap opens beside its primary series', async () => {
    const { servicesManager, addViewportToSyncGroup } = makeServices();

    await ensureHeatmapImageSliceSync({ servicesManager });

    expect(addViewportToSyncGroup).toHaveBeenCalledTimes(2);
  });

  it('does nothing with a single viewport', async () => {
    const { servicesManager, addViewportToSyncGroup } = makeServices({ viewportIds: ['v1'] });

    await ensureHeatmapImageSliceSync({ servicesManager });

    expect(addViewportToSyncGroup).not.toHaveBeenCalled();
  });

  it('is a no-op when the pair is already synced', async () => {
    const { servicesManager, addViewportToSyncGroup } = makeServices({ hasSync: true });

    await ensureHeatmapImageSliceSync({ servicesManager });

    expect(addViewportToSyncGroup).not.toHaveBeenCalled();
  });

  // Grid events arrive in bursts; two overlapping attempts could each install membership.
  it('serialises concurrent attempts', async () => {
    const { servicesManager, addViewportToSyncGroup } = makeServices();

    await Promise.all([
      ensureHeatmapImageSliceSync({ servicesManager }),
      ensureHeatmapImageSliceSync({ servicesManager }),
      ensureHeatmapImageSliceSync({ servicesManager }),
    ]);

    expect(alignHeatmapSlice).toHaveBeenCalledTimes(1);
    expect(addViewportToSyncGroup).toHaveBeenCalledTimes(2);
  });

  it('reports enabled state from the sync group', () => {
    expect(isHeatmapSyncEnabled({ servicesManager: makeServices().servicesManager })).toBe(false);
    expect(
      isHeatmapSyncEnabled({ servicesManager: makeServices({ hasSync: true }).servicesManager })
    ).toBe(true);
  });
});

describe('the manual switch-off preference', () => {
  it('stops the automatic path re-arming sync, until it is reset', async () => {
    const { servicesManager, removeViewportFromSyncGroup, addViewportToSyncGroup } = makeServices({
      hasSync: true,
    });

    await toggleHeatmapImageSliceSync({ servicesManager });
    expect(removeViewportFromSyncGroup).toHaveBeenCalledTimes(2);
    expect(isHeatmapSyncUserDisabled({ servicesManager })).toBe(true);

    await ensureHeatmapImageSliceSync({ servicesManager });
    expect(addViewportToSyncGroup).not.toHaveBeenCalled();

    resetHeatmapSyncPreference({ servicesManager });
    expect(isHeatmapSyncUserDisabled({ servicesManager })).toBe(false);
  });

  it('is scoped per viewer, so one viewer cannot disable another', async () => {
    const first = makeServices({ hasSync: true });
    const second = makeServices();

    await toggleHeatmapImageSliceSync({ servicesManager: first.servicesManager });
    expect(isHeatmapSyncUserDisabled({ servicesManager: first.servicesManager })).toBe(true);
    expect(isHeatmapSyncUserDisabled({ servicesManager: second.servicesManager })).toBe(false);

    await ensureHeatmapImageSliceSync({ servicesManager: second.servicesManager });
    expect(second.addViewportToSyncGroup).toHaveBeenCalledTimes(2);
  });

  it('starts undisabled for a viewer that has never toggled', () => {
    const { servicesManager } = makeServices();

    expect(isHeatmapSyncUserDisabled({ servicesManager })).toBe(false);
  });
});

describe('completeness', () => {
  it('is false for a half-built group', () => {
    // Opening the heatmap recreates the first viewport's cornerstone instance, dropping it
    // from the group: the heatmap reports synced, the series it must follow does not.
    const { servicesManager } = makeServices({ syncedIds: ['v2'] });

    expect(isHeatmapSyncEnabled({ servicesManager })).toBe(true);
    expect(isHeatmapSyncComplete({ servicesManager })).toBe(false);
  });

  it('repairs a half-built group rather than treating it as done', async () => {
    const { servicesManager, addViewportToSyncGroup } = makeServices({ syncedIds: ['v2'] });

    await ensureHeatmapImageSliceSync({ servicesManager });

    expect(addViewportToSyncGroup).toHaveBeenCalledTimes(2);
  });

  it('is true only when the resolved pair is in the group', () => {
    expect(
      isHeatmapSyncComplete({ servicesManager: makeServices({ syncedIds: ['v1', 'v2'] }).servicesManager })
    ).toBe(true);
  });

  // Membership over "all populated viewports" would call this complete; the pair does not exist.
  it('is false when there is no pair, however many viewports are synced', () => {
    const { servicesManager } = makeServices({ paired: false, syncedIds: ['v1', 'v2'] });

    expect(isHeatmapSyncComplete({ servicesManager })).toBe(false);
  });

  it('is false for a lone viewport', () => {
    const { servicesManager } = makeServices({ viewportIds: ['v1'], syncedIds: ['v1'] });

    expect(isHeatmapSyncComplete({ servicesManager })).toBe(false);
  });
});

describe('disable', () => {
  it('removes every populated viewport from the group', async () => {
    const { servicesManager, removeViewportFromSyncGroup } = makeServices({ hasSync: true });

    await toggleHeatmapImageSliceSync({ servicesManager });

    expect(removeViewportFromSyncGroup).toHaveBeenCalledTimes(2);
    expect(removeViewportFromSyncGroup).toHaveBeenCalledWith('v2', 'engine-v2', HEATMAP_SYNC_ID);
  });

  it('does nothing when fewer than two viewports have display sets', async () => {
    const { servicesManager, addViewportToSyncGroup, removeViewportFromSyncGroup } = makeServices({
      viewportIds: ['v1'],
    });

    await toggleHeatmapImageSliceSync({ servicesManager });

    expect(addViewportToSyncGroup).not.toHaveBeenCalled();
    expect(removeViewportFromSyncGroup).not.toHaveBeenCalled();
  });

  it('does not align when switching sync off', async () => {
    const { servicesManager } = makeServices({ hasSync: true });

    await toggleHeatmapImageSliceSync({ servicesManager });

    expect(alignHeatmapSlice).not.toHaveBeenCalled();
  });
});
