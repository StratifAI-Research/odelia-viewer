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
jest.mock('./alignHeatmapSlice', () => jest.fn(async () => 7));

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
  const getDisplaySetByUID = jest.fn((uid: string) => {
    const id = String(uid).replace(/^ds-/, '');
    const sop = `sop-${id}`;
    const instance: any = { SOPInstanceUID: sop };
    if (paired && id !== primary) {
      instance.ReferencedImageSequence = [{ ReferencedSOPInstanceUID: `sop-${primary}` }];
    }
    return { Modality: id === primary ? 'MR' : 'SC', SOPInstanceUID: sop, instance };
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
  (alignHeatmapSlice as jest.Mock).mockImplementation(async () => 7);
});

describe('toggleHeatmapImageSliceSync', () => {
  it('does nothing when fewer than two viewports have display sets', async () => {
    const { servicesManager, addViewportToSyncGroup, removeViewportFromSyncGroup } = makeServices({
      viewportIds: ['v1'],
    });
    await toggleHeatmapImageSliceSync({ servicesManager });
    expect(addViewportToSyncGroup).not.toHaveBeenCalled();
    expect(removeViewportFromSyncGroup).not.toHaveBeenCalled();
  });

  it('enables sync by adding every viewport to the sync group', async () => {
    const { servicesManager, addViewportToSyncGroup, removeViewportFromSyncGroup } = makeServices();
    await toggleHeatmapImageSliceSync({ servicesManager });

    expect(removeViewportFromSyncGroup).not.toHaveBeenCalled();
    expect(addViewportToSyncGroup).toHaveBeenCalledTimes(2);
    expect(addViewportToSyncGroup).toHaveBeenCalledWith('v1', 'engine-v1', {
      type: 'heatmapImageSlice',
      id: HEATMAP_SYNC_ID,
      source: true,
      target: true,
    });
  });

  it('disables sync by removing every viewport when one already has sync', async () => {
    const { servicesManager, addViewportToSyncGroup, removeViewportFromSyncGroup } = makeServices({
      hasSync: true,
    });
    await toggleHeatmapImageSliceSync({ servicesManager });

    expect(addViewportToSyncGroup).not.toHaveBeenCalled();
    expect(removeViewportFromSyncGroup).toHaveBeenCalledTimes(2);
    expect(removeViewportFromSyncGroup).toHaveBeenCalledWith('v2', 'engine-v2', HEATMAP_SYNC_ID);
  });

  it('skips viewports the cornerstone service cannot resolve on the enable path', async () => {
    const { servicesManager, addViewportToSyncGroup } = makeServices({ missing: ['v2'] });
    await toggleHeatmapImageSliceSync({ servicesManager });
    expect(addViewportToSyncGroup).toHaveBeenCalledTimes(1);
    expect(addViewportToSyncGroup).toHaveBeenCalledWith('v1', 'engine-v1', expect.anything());
  });
});

describe('aligning on enable', () => {
  // The defect: addViewportToSyncGroup only arms the synchronizer for the NEXT slice-change
  // event, so pressing sync appeared to do nothing until the reader scrolled.
  it('aligns the non-active viewports to the active one when sync is switched on', async () => {
    const { servicesManager } = makeServices({ activeViewportId: 'v1' });

    await toggleHeatmapImageSliceSync({ servicesManager });

    expect(alignHeatmapSlice).toHaveBeenCalledTimes(1);
    expect(alignHeatmapSlice).toHaveBeenCalledWith(
      expect.objectContaining({ element: { id: 'v1' } }),
      expect.objectContaining({ element: { id: 'v2' } }),
      expect.objectContaining({ sourceViewportId: 'v1', targetViewportId: 'v2' })
    );
  });

  it('does not align the active viewport to itself', async () => {
    const { servicesManager } = makeServices({
      viewportIds: ['v1', 'v2', 'v3'],
      activeViewportId: 'v2',
    });

    await toggleHeatmapImageSliceSync({ servicesManager });

    const targets = (alignHeatmapSlice as jest.Mock).mock.calls.map(c => c[2].targetViewportId);
    expect(targets).toEqual(['v1', 'v3']);
  });

  it('does not align when switching sync off', async () => {
    const { servicesManager } = makeServices({ hasSync: true });

    await toggleHeatmapImageSliceSync({ servicesManager });

    expect(alignHeatmapSlice).not.toHaveBeenCalled();
  });
});

describe('rollback when the initial alignment fails', () => {
  // A built-but-unaligned group is the worst outcome: isHeatmapSyncComplete reports it as
  // done, so the automatic path never retries, while the viewports sit on unrelated slices.
  it('removes the viewports it added instead of leaving a half-aligned group', async () => {
    (alignHeatmapSlice as jest.Mock).mockRejectedValueOnce(new Error('no metadata'));
    const { servicesManager, addViewportToSyncGroup, removeViewportFromSyncGroup } = makeServices();

    await toggleHeatmapImageSliceSync({ servicesManager });

    expect(addViewportToSyncGroup).toHaveBeenCalledTimes(2);
    expect(removeViewportFromSyncGroup).toHaveBeenCalledTimes(2);
    expect(removeViewportFromSyncGroup).toHaveBeenCalledWith('v1', 'engine-v1', HEATMAP_SYNC_ID);
    expect(removeViewportFromSyncGroup).toHaveBeenCalledWith('v2', 'engine-v2', HEATMAP_SYNC_ID);
  });

  it('rolls back when the active viewport cannot be resolved as a source', async () => {
    // `missing` is what makes it unresolvable; naming a viewport that is not in the grid is
    // not enough, since the harness resolves any id it has not been told is missing.
    const { servicesManager, addViewportToSyncGroup, removeViewportFromSyncGroup } = makeServices({
      activeViewportId: 'gone',
      missing: ['gone'],
    });

    await toggleHeatmapImageSliceSync({ servicesManager });

    expect(addViewportToSyncGroup).toHaveBeenCalledTimes(2);
    expect(removeViewportFromSyncGroup).toHaveBeenCalledTimes(2);
  });

  it('only rolls back what it actually added', async () => {
    (alignHeatmapSlice as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    // Three viewports with the middle one unresolvable: v1 and v3 get added, v2 never does.
    // v3's alignment then fails, so the rollback must touch v1 and v3 and leave v2 alone.
    const { servicesManager, addViewportToSyncGroup, removeViewportFromSyncGroup } = makeServices({
      viewportIds: ['v1', 'v2', 'v3'],
      missing: ['v2'],
    });

    await toggleHeatmapImageSliceSync({ servicesManager });

    expect(addViewportToSyncGroup).toHaveBeenCalledTimes(2);
    expect(removeViewportFromSyncGroup).toHaveBeenCalledTimes(2);
    expect(removeViewportFromSyncGroup).toHaveBeenCalledWith('v1', 'engine-v1', HEATMAP_SYNC_ID);
    expect(removeViewportFromSyncGroup).toHaveBeenCalledWith('v3', 'engine-v3', HEATMAP_SYNC_ID);
    expect(removeViewportFromSyncGroup).not.toHaveBeenCalledWith(
      'v2',
      expect.anything(),
      expect.anything()
    );
  });
});

describe('ensureHeatmapImageSliceSync', () => {
  it('enables sync once a second viewport shows a related AI result', async () => {
    const { servicesManager, addViewportToSyncGroup } = makeServices();

    await ensureHeatmapImageSliceSync({ servicesManager });

    expect(addViewportToSyncGroup).toHaveBeenCalledTimes(2);
  });

  // A modality test would auto-link any incidental SC/SR in the study. This asks the DICOM:
  // without a reference between the display sets, the viewports are left alone.
  it('leaves unrelated display sets alone even when one is an SC', async () => {
    const { servicesManager, addViewportToSyncGroup } = makeServices({ paired: false });

    await ensureHeatmapImageSliceSync({ servicesManager });

    expect(addViewportToSyncGroup).not.toHaveBeenCalled();
  });

  it('waits for a later event while any viewport is not yet renderable', async () => {
    const { servicesManager, addViewportToSyncGroup } = makeServices({ missing: ['v2'] });

    await ensureHeatmapImageSliceSync({ servicesManager });

    // Enabling here would add only v1 and leave the group half-built.
    expect(addViewportToSyncGroup).not.toHaveBeenCalled();
  });

  it('does nothing with a single viewport', async () => {
    const { servicesManager, addViewportToSyncGroup } = makeServices({ viewportIds: ['v1'] });

    await ensureHeatmapImageSliceSync({ servicesManager });

    expect(addViewportToSyncGroup).not.toHaveBeenCalled();
  });

  it('is a no-op when sync is already complete', async () => {
    const { servicesManager, addViewportToSyncGroup } = makeServices({ hasSync: true });

    await ensureHeatmapImageSliceSync({ servicesManager });

    expect(addViewportToSyncGroup).not.toHaveBeenCalled();
  });

  it('reports enabled state from the sync group', () => {
    expect(isHeatmapSyncEnabled({ servicesManager: makeServices().servicesManager })).toBe(false);
    expect(
      isHeatmapSyncEnabled({ servicesManager: makeServices({ hasSync: true }).servicesManager })
    ).toBe(true);
  });
});

describe('the manual switch-off preference', () => {
  // Without this the subscription would re-enable sync on the very next grid change and the
  // toolbar toggle would look broken.
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

  // The reason this is a WeakMap on servicesManager rather than a module-level boolean: two
  // viewer roots in one realm, or a mode re-entered while the previous instance exits, would
  // otherwise read and clobber each other's preference.
  it('is scoped per viewer, so one viewer cannot disable another', async () => {
    const first = makeServices({ hasSync: true });
    const second = makeServices();

    await toggleHeatmapImageSliceSync({ servicesManager: first.servicesManager });
    expect(isHeatmapSyncUserDisabled({ servicesManager: first.servicesManager })).toBe(true);
    expect(isHeatmapSyncUserDisabled({ servicesManager: second.servicesManager })).toBe(false);

    // The second viewer still auto-syncs despite the first having opted out.
    await ensureHeatmapImageSliceSync({ servicesManager: second.servicesManager });
    expect(second.addViewportToSyncGroup).toHaveBeenCalledTimes(2);
  });

  it('starts undisabled for a viewer that has never toggled', () => {
    const { servicesManager } = makeServices();

    expect(isHeatmapSyncUserDisabled({ servicesManager })).toBe(false);
  });
});

describe('half-built sync groups', () => {
  // Reproduces what the browser showed: opening the heatmap in a second viewport recreates
  // the first viewport's cornerstone instance, dropping it from the group. The heatmap
  // reports synced, the series it must follow does not.
  const halfBuilt = () => makeServices({ syncedIds: ['v2'] });

  it('counts as enabled but not complete', () => {
    const { servicesManager } = halfBuilt();

    expect(isHeatmapSyncEnabled({ servicesManager })).toBe(true);
    expect(isHeatmapSyncComplete({ servicesManager })).toBe(false);
  });

  it('is repaired rather than mistaken for already-synced', async () => {
    const { servicesManager, addViewportToSyncGroup } = halfBuilt();

    await ensureHeatmapImageSliceSync({ servicesManager });

    // Re-adds both; Synchronizer.addSource/addTarget dedupe the one already present.
    expect(addViewportToSyncGroup).toHaveBeenCalledTimes(2);
    expect(alignHeatmapSlice).toHaveBeenCalledTimes(1);
  });

  it('treats a fully built group as complete and leaves it alone', async () => {
    const { servicesManager, addViewportToSyncGroup } = makeServices({ syncedIds: ['v1', 'v2'] });

    expect(isHeatmapSyncComplete({ servicesManager })).toBe(true);
    await ensureHeatmapImageSliceSync({ servicesManager });
    expect(addViewportToSyncGroup).not.toHaveBeenCalled();
  });

  it('does not call a lone viewport complete', () => {
    const { servicesManager } = makeServices({ viewportIds: ['v1'], syncedIds: ['v1'] });

    expect(isHeatmapSyncComplete({ servicesManager })).toBe(false);
  });
});
