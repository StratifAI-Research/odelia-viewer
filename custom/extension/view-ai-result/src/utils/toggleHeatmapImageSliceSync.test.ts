import { toggleHeatmapImageSliceSync } from './toggleHeatmapImageSliceSync';

const HEATMAP_SYNC_ID = 'HEATMAP_IMAGE_SLICE_SYNC';

const gridViewport = (viewportId: string) => ({
  displaySetInstanceUIDs: ['ds'],
  viewportOptions: { viewportId },
});

const makeServices = (opts: { hasSync?: boolean; viewportIds?: string[]; missing?: string[] } = {}) => {
  const viewportIds = opts.viewportIds ?? ['v1', 'v2'];
  const missing = new Set(opts.missing ?? []);

  const viewports = new Map<string, any>();
  viewportIds.forEach(id => viewports.set(id, gridViewport(id)));

  const addViewportToSyncGroup = jest.fn();
  const removeViewportFromSyncGroup = jest.fn();
  const getSynchronizersForViewport = jest.fn(() =>
    opts.hasSync ? [{ id: HEATMAP_SYNC_ID }] : [{ id: 'something-else' }]
  );

  const getCornerstoneViewport = jest.fn((id: string) =>
    missing.has(id) ? undefined : { getRenderingEngine: () => ({ id: `engine-${id}` }) }
  );

  const servicesManager = {
    services: {
      syncGroupService: { addViewportToSyncGroup, removeViewportFromSyncGroup, getSynchronizersForViewport },
      cornerstoneViewportService: { getCornerstoneViewport },
      viewportGridService: { getState: () => ({ viewports }) },
    },
  };

  return { servicesManager, addViewportToSyncGroup, removeViewportFromSyncGroup, getCornerstoneViewport };
};

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
    const { servicesManager, addViewportToSyncGroup } = makeServices({ hasSync: false, missing: ['v2'] });
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

    const addViewportToSyncGroup = jest.fn((id: string) => { synced.add(id); });
    const removeViewportFromSyncGroup = jest.fn((id: string) => { synced.delete(id); });
    const getSynchronizersForViewport = jest.fn((id: string) =>
      synced.has(id) ? [{ id: HEATMAP_SYNC_ID }] : [{ id: 'something-else' }]
    );
    const getCornerstoneViewport = jest.fn((id: string) => ({
      getRenderingEngine: () => ({ id: `engine-${id}` }),
    }));

    const servicesManager = {
      services: {
        syncGroupService: { addViewportToSyncGroup, removeViewportFromSyncGroup, getSynchronizersForViewport },
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
