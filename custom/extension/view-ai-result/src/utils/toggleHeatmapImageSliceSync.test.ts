import alignHeatmapSlice from './alignHeatmapSlice';
import {
  toggleHeatmapImageSliceSync,
  ensureHeatmapImageSliceSync,
  isHeatmapSyncEnabled,
  isHeatmapSyncComplete,
  isHeatmapSyncUserDisabled,
  resetHeatmapSyncPreference,
} from './toggleHeatmapImageSliceSync';

// The alignment itself is covered by createHeatmapImageSliceSynchronizer.test.ts against
// real geometry; here only the fact that enabling triggers it matters.
jest.mock('./alignHeatmapSlice', () => jest.fn(async () => 7));

const HEATMAP_SYNC_ID = 'HEATMAP_IMAGE_SLICE_SYNC';

const gridViewport = (viewportId: string, displaySetInstanceUIDs = ['ds']) => ({
  displaySetInstanceUIDs,
  viewportOptions: { viewportId },
});

const makeServices = (
  opts: {
    hasSync?: boolean;
    viewportIds?: string[];
    missing?: string[];
    /** viewportId -> Modality of the display set it shows. Defaults to MR everywhere. */
    modalities?: Record<string, string>;
    activeViewportId?: string;
    syncedIds?: string[];
  } = {}
) => {
  const viewportIds = opts.viewportIds ?? ['v1', 'v2'];
  const missing = new Set(opts.missing ?? []);

  const viewports = new Map<string, any>();
  viewportIds.forEach(id => viewports.set(id, gridViewport(id, [`ds-${id}`])));

  const addViewportToSyncGroup = jest.fn();
  const removeViewportFromSyncGroup = jest.fn();
  // `syncedIds` lets a test describe a HALF-BUILT group; `hasSync` keeps the all-or-nothing
  // shorthand the older tests use.
  const syncedIds = opts.syncedIds ? new Set(opts.syncedIds) : undefined;
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
          getImageIds: () => ['a', 'b'],
          getFrameOfReferenceUID: () => 'FOR',
          element: { id },
        }
  );

  const getDisplaySetByUID = jest.fn((uid: string) => ({
    Modality: opts.modalities?.[String(uid).replace(/^ds-/, '')] ?? 'MR',
  }));

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
  resetHeatmapSyncPreference();
  (alignHeatmapSlice as jest.Mock).mockClear();
});

describe('toggleHeatmapImageSliceSync', () => {
  it('does nothing when fewer than two viewports have display sets', () => {
    const { servicesManager, addViewportToSyncGroup, removeViewportFromSyncGroup } = makeServices({
      viewportIds: ['v1'],
    });
    toggleHeatmapImageSliceSync({ servicesManager });
    expect(addViewportToSyncGroup).not.toHaveBeenCalled();
    expect(removeViewportFromSyncGroup).not.toHaveBeenCalled();
  });

  it('enables sync by adding every viewport to the sync group', () => {
    const { servicesManager, addViewportToSyncGroup, removeViewportFromSyncGroup } = makeServices({
      hasSync: false,
    });
    toggleHeatmapImageSliceSync({ servicesManager });

    expect(removeViewportFromSyncGroup).not.toHaveBeenCalled();
    expect(addViewportToSyncGroup).toHaveBeenCalledTimes(2);
    expect(addViewportToSyncGroup).toHaveBeenCalledWith('v1', 'engine-v1', {
      type: 'heatmapImageSlice',
      id: HEATMAP_SYNC_ID,
      source: true,
      target: true,
    });
  });

  it('disables sync by removing every viewport when one already has sync', () => {
    const { servicesManager, addViewportToSyncGroup, removeViewportFromSyncGroup } = makeServices({
      hasSync: true,
    });
    toggleHeatmapImageSliceSync({ servicesManager });

    expect(addViewportToSyncGroup).not.toHaveBeenCalled();
    expect(removeViewportFromSyncGroup).toHaveBeenCalledTimes(2);
    expect(removeViewportFromSyncGroup).toHaveBeenCalledWith('v2', 'engine-v2', HEATMAP_SYNC_ID);
  });

  it('skips viewports the cornerstone service cannot resolve on the enable path', () => {
    const { servicesManager, addViewportToSyncGroup } = makeServices({
      hasSync: false,
      missing: ['v2'],
    });
    toggleHeatmapImageSliceSync({ servicesManager });
    expect(addViewportToSyncGroup).toHaveBeenCalledTimes(1);
    expect(addViewportToSyncGroup).toHaveBeenCalledWith('v1', 'engine-v1', expect.anything());
  });

  it('round-trips on repeated toggles against shared sync state', () => {
    // One stateful mock: add/remove mutate the synced set and the synchronizer
    // lookup reflects it, so each toggle observes the previous toggle's effect.
    const synced = new Set<string>();
    const viewports = new Map<string, any>();
    ['v1', 'v2'].forEach(id => viewports.set(id, gridViewport(id)));

    const addViewportToSyncGroup = jest.fn((id: string) => {
      synced.add(id);
    });
    const removeViewportFromSyncGroup = jest.fn((id: string) => {
      synced.delete(id);
    });
    const getSynchronizersForViewport = jest.fn((id: string) =>
      synced.has(id) ? [{ id: HEATMAP_SYNC_ID }] : [{ id: 'something-else' }]
    );
    const getCornerstoneViewport = jest.fn((id: string) => ({
      getRenderingEngine: () => ({ id: `engine-${id}` }),
    }));

    const servicesManager = {
      services: {
        syncGroupService: {
          addViewportToSyncGroup,
          removeViewportFromSyncGroup,
          getSynchronizersForViewport,
        },
        cornerstoneViewportService: { getCornerstoneViewport },
        viewportGridService: { getState: () => ({ viewports }) },
      },
    };

    // First toggle: nothing synced yet -> enable both viewports.
    toggleHeatmapImageSliceSync({ servicesManager });
    expect(addViewportToSyncGroup).toHaveBeenCalledTimes(2);
    expect(removeViewportFromSyncGroup).not.toHaveBeenCalled();
    expect(synced).toEqual(new Set(['v1', 'v2']));

    // Second toggle: shared state now reports sync -> disable both viewports.
    toggleHeatmapImageSliceSync({ servicesManager });
    expect(removeViewportFromSyncGroup).toHaveBeenCalledTimes(2);
    expect(synced.size).toBe(0);

    // Third toggle: back to enabled, proving a clean round-trip.
    toggleHeatmapImageSliceSync({ servicesManager });
    expect(addViewportToSyncGroup).toHaveBeenCalledTimes(4);
    expect(synced).toEqual(new Set(['v1', 'v2']));
  });
});

describe('aligning on enable', () => {
  // The defect: addViewportToSyncGroup only arms the synchronizer for the NEXT
  // slice-change event, so pressing sync appeared to do nothing until the reader scrolled.
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

  it('still builds the sync group when an alignment throws', async () => {
    (alignHeatmapSlice as jest.Mock).mockRejectedValueOnce(new Error('no metadata'));
    const { servicesManager, addViewportToSyncGroup } = makeServices();

    await expect(toggleHeatmapImageSliceSync({ servicesManager })).resolves.toBeUndefined();
    expect(addViewportToSyncGroup).toHaveBeenCalledTimes(2);
  });

  it('does not align when switching sync off', async () => {
    const { servicesManager } = makeServices({ hasSync: true });

    await toggleHeatmapImageSliceSync({ servicesManager });

    expect(alignHeatmapSlice).not.toHaveBeenCalled();
  });
});

describe('ensureHeatmapImageSliceSync', () => {
  const withHeatmap = (extra = {}) =>
    makeServices({ modalities: { v2: 'SC' }, ...extra });

  it('enables sync once a second viewport shows an AI result', async () => {
    const { servicesManager, addViewportToSyncGroup } = withHeatmap();

    await ensureHeatmapImageSliceSync({ servicesManager });

    expect(addViewportToSyncGroup).toHaveBeenCalledTimes(2);
  });

  it('leaves two ordinary series alone', async () => {
    const { servicesManager, addViewportToSyncGroup } = makeServices();

    await ensureHeatmapImageSliceSync({ servicesManager });

    expect(addViewportToSyncGroup).not.toHaveBeenCalled();
  });

  it('waits for a later event while any viewport is not yet renderable', async () => {
    const { servicesManager, addViewportToSyncGroup } = withHeatmap({ missing: ['v2'] });

    await ensureHeatmapImageSliceSync({ servicesManager });

    // Enabling here would add only v1 and leave the group half-built.
    expect(addViewportToSyncGroup).not.toHaveBeenCalled();
  });

  it('does nothing with a single viewport', async () => {
    const { servicesManager, addViewportToSyncGroup } = withHeatmap({ viewportIds: ['v1'] });

    await ensureHeatmapImageSliceSync({ servicesManager });

    expect(addViewportToSyncGroup).not.toHaveBeenCalled();
  });

  it('is a no-op when sync is already on', async () => {
    const { servicesManager, addViewportToSyncGroup } = withHeatmap({ hasSync: true });

    await ensureHeatmapImageSliceSync({ servicesManager });

    expect(addViewportToSyncGroup).not.toHaveBeenCalled();
  });

  // Without this the subscription would re-enable sync on the very next grid change and
  // the toolbar toggle would look broken.
  it('respects a manual switch-off and stops re-arming sync', async () => {
    const enabled = makeServices({ modalities: { v2: 'SC' }, hasSync: true });

    await toggleHeatmapImageSliceSync({ servicesManager: enabled.servicesManager });
    expect(enabled.removeViewportFromSyncGroup).toHaveBeenCalledTimes(2);
    expect(isHeatmapSyncUserDisabled()).toBe(true);

    const after = withHeatmap();
    await ensureHeatmapImageSliceSync({ servicesManager: after.servicesManager });
    expect(after.addViewportToSyncGroup).not.toHaveBeenCalled();

    // ...until the preference is cleared, which onModeEnter does.
    resetHeatmapSyncPreference();
    await ensureHeatmapImageSliceSync({ servicesManager: after.servicesManager });
    expect(after.addViewportToSyncGroup).toHaveBeenCalledTimes(2);
  });

  it('reports enabled state from the sync group', () => {
    expect(isHeatmapSyncEnabled({ servicesManager: makeServices().servicesManager })).toBe(false);
    expect(
      isHeatmapSyncEnabled({ servicesManager: makeServices({ hasSync: true }).servicesManager })
    ).toBe(true);
  });
});

describe('half-built sync groups', () => {
  // Reproduces what the browser showed: opening the heatmap in a second viewport recreates
  // the first viewport's cornerstone instance, dropping it from the group. The heatmap
  // reports synced, the series it must follow does not.
  const halfBuilt = () =>
    makeServices({ modalities: { v2: 'SC' }, syncedIds: ['v2'] });

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
    const { servicesManager, addViewportToSyncGroup } = makeServices({
      modalities: { v2: 'SC' },
      syncedIds: ['v1', 'v2'],
    });

    expect(isHeatmapSyncComplete({ servicesManager })).toBe(true);
    await ensureHeatmapImageSliceSync({ servicesManager });
    expect(addViewportToSyncGroup).not.toHaveBeenCalled();
  });

  it('does not call a lone viewport complete', () => {
    const { servicesManager } = makeServices({ viewportIds: ['v1'], syncedIds: ['v1'] });

    expect(isHeatmapSyncComplete({ servicesManager })).toBe(false);
  });
});
