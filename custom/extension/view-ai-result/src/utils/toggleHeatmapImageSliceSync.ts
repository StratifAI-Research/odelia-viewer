const HEATMAP_SYNC_ID = 'HEATMAP_IMAGE_SLICE_SYNC';

/**
 * Toggle image slice synchronization with proper configuration for volume viewports
 */
export function toggleHeatmapImageSliceSync({ servicesManager }) {
  const { syncGroupService, cornerstoneViewportService, viewportGridService } =
    servicesManager.services;

  const { viewports } = viewportGridService.getState();
  const viewportArray = Array.from(viewports.values()).filter(
    (vp: any) => vp.displaySetInstanceUIDs?.length > 0
  );

  if (viewportArray.length < 2) {
    console.warn('[HeatmapSync] Need at least 2 viewports to sync');
    return;
  }

  // Check if any viewport already has sync enabled
  const someViewportHasSync = viewportArray.some((gridViewport: any) => {
    const { viewportId } = gridViewport.viewportOptions;
    const syncStates = syncGroupService.getSynchronizersForViewport(viewportId);
    const imageSync = syncStates.find(syncState => syncState.id === HEATMAP_SYNC_ID);
    return !!imageSync;
  });

  if (someViewportHasSync) {
    // Disable sync by removing viewports from sync group

    viewportArray.forEach((gridViewport: any) => {
      const { viewportId } = gridViewport.viewportOptions;
      const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

      if (!viewport) {
        return;
      }

      syncGroupService.removeViewportFromSyncGroup(
        viewportId,
        viewport.getRenderingEngine().id,
        HEATMAP_SYNC_ID
      );
    });
    return;
  }

  // Enable sync by adding viewports to sync group

  viewportArray.forEach((gridViewport: any) => {
    const { viewportId } = gridViewport.viewportOptions;
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

    if (!viewport) {
      console.warn('[HeatmapSync] Viewport not found:', viewportId);
      return;
    }

    syncGroupService.addViewportToSyncGroup(viewportId, viewport.getRenderingEngine().id, {
      type: 'heatmapImageSlice',
      id: HEATMAP_SYNC_ID,
      source: true,
      target: true,
    });
  });
}
