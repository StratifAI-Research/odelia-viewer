import alignHeatmapSlice from './alignHeatmapSlice';

const HEATMAP_SYNC_ID = 'HEATMAP_IMAGE_SLICE_SYNC';

/**
 * Whether the reader switched sync off by hand.
 *
 * ensureHeatmapImageSliceSync() turns sync on automatically when a second viewport starts
 * showing a heatmap, and it fires on every grid change -- so without this it would
 * immediately undo a manual switch-off and the toggle would look broken. Reset per mode
 * entry via resetHeatmapSyncPreference().
 */
let userDisabledSync = false;

export const isHeatmapSyncUserDisabled = (): boolean => userDisabledSync;

export const resetHeatmapSyncPreference = (): void => {
  userDisabledSync = false;
};

const syncableViewports = viewportGridService =>
  Array.from(viewportGridService.getState().viewports.values()).filter(
    (vp: any) => vp.displaySetInstanceUIDs?.length > 0
  );

const viewportIdOf = (gridViewport: any) => gridViewport.viewportOptions?.viewportId;

const isInHeatmapSyncGroup = (syncGroupService, gridViewport: any) =>
  syncGroupService
    .getSynchronizersForViewport(viewportIdOf(gridViewport))
    .some(syncState => syncState.id === HEATMAP_SYNC_ID);

/**
 * True when ANY viewport is in the heatmap sync group -- the toggle's on/off question.
 */
export function isHeatmapSyncEnabled({ servicesManager }): boolean {
  const { syncGroupService, viewportGridService } = servicesManager.services;

  return syncableViewports(viewportGridService).some((gridViewport: any) =>
    isInHeatmapSyncGroup(syncGroupService, gridViewport)
  );
}

/**
 * True when EVERY populated viewport is in the group, i.e. sync actually works.
 *
 * Distinct from isHeatmapSyncEnabled on purpose. A grid change can rebuild one cornerstone
 * viewport after the group was formed -- opening the heatmap in a second viewport recreates
 * the first -- which silently drops it, leaving a group that contains the heatmap but not
 * the series it is supposed to follow. Gating the automatic path on `some` treated that
 * half-built state as "already on" and never repaired it: measured with the MR viewport
 * reporting inSyncGroup=false while the heatmap reported true, 16.50 mm apart and staying
 * apart while scrolling.
 */
export function isHeatmapSyncComplete({ servicesManager }): boolean {
  const { syncGroupService, viewportGridService } = servicesManager.services;
  const viewportArray = syncableViewports(viewportGridService);

  return (
    viewportArray.length >= 2 &&
    viewportArray.every((gridViewport: any) =>
      isInHeatmapSyncGroup(syncGroupService, gridViewport)
    )
  );
}

/**
 * Add every populated viewport to the heatmap sync group, then align them straight away.
 *
 * addViewportToSyncGroup only arms the synchronizer for the NEXT slice-change event, so on
 * its own it leaves the newly opened heatmap on whichever slice it loaded at -- the reader
 * had to scroll before anything lined up. The explicit alignHeatmapSlice pass is what makes
 * enabling sync take effect at the moment it is enabled.
 */
export async function enableHeatmapImageSliceSync({ servicesManager }): Promise<void> {
  const { syncGroupService, cornerstoneViewportService, viewportGridService } =
    servicesManager.services;

  const viewportArray = syncableViewports(viewportGridService);

  if (viewportArray.length < 2) {
    console.warn('[HeatmapSync] Need at least 2 viewports to sync');
    return;
  }

  viewportArray.forEach((gridViewport: any) => {
    const viewportId = viewportIdOf(gridViewport);
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

  // The active viewport is the one the reader is driving, so it is the source everything
  // else lines up to.
  const activeViewportId = viewportGridService.getState().activeViewportId;
  const source = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);

  if (!source) {
    return;
  }

  for (const gridViewport of viewportArray) {
    const viewportId = viewportIdOf(gridViewport);

    if (viewportId === activeViewportId) {
      continue;
    }

    const target = cornerstoneViewportService.getCornerstoneViewport(viewportId);

    if (!target) {
      continue;
    }

    try {
      await alignHeatmapSlice(source, target, {
        sourceViewportId: activeViewportId,
        targetViewportId: viewportId,
      });
    } catch (error) {
      // An alignment failure must not leave the sync group half-built.
      console.warn('[HeatmapSync] Initial alignment failed for', viewportId, error);
    }
  }
}

export function disableHeatmapImageSliceSync({ servicesManager }): void {
  const { syncGroupService, cornerstoneViewportService, viewportGridService } =
    servicesManager.services;

  syncableViewports(viewportGridService).forEach((gridViewport: any) => {
    const viewportId = viewportIdOf(gridViewport);
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
}

/**
 * Turn sync on automatically once a second viewport shows an AI result, unless the reader
 * turned it off.
 *
 * Written to be safe on every GRID_STATE_CHANGED, which fires often: it bails out early on
 * each of the four conditions below rather than doing work, and once sync is on the
 * isHeatmapSyncEnabled() check makes it a cheap no-op.
 */
export async function ensureHeatmapImageSliceSync({ servicesManager }): Promise<void> {
  const { viewportGridService, cornerstoneViewportService, displaySetService } =
    servicesManager.services;

  if (userDisabledSync) {
    return;
  }

  const viewportArray = syncableViewports(viewportGridService);

  if (viewportArray.length < 2) {
    return;
  }

  // `Complete`, not `Enabled`: a half-built group must be repaired, not mistaken for done.
  if (isHeatmapSyncComplete({ servicesManager })) {
    return;
  }

  // Scoped to the case this synchronizer exists for -- an AI result (SC heatmap or SR)
  // beside its primary imaging. Two ordinary series side by side are left alone; nothing
  // here should start syncing viewports the reader did not ask to be linked.
  const showsAIResult = viewportArray.some((gridViewport: any) =>
    (gridViewport.displaySetInstanceUIDs || []).some(uid => {
      const modality = displaySetService?.getDisplaySetByUID?.(uid)?.Modality;
      return modality === 'SC' || modality === 'SR';
    })
  );

  if (!showsAIResult) {
    return;
  }

  // A grid change lands before the cornerstone viewports behind it necessarily exist.
  // Enabling now would add only the resolvable ones and leave the group half-built, so
  // wait and let a later event do it.
  const allRenderable = viewportArray.every((gridViewport: any) =>
    cornerstoneViewportService.getCornerstoneViewport(viewportIdOf(gridViewport))
  );

  if (!allRenderable) {
    return;
  }

  await enableHeatmapImageSliceSync({ servicesManager });
}

/**
 * Toggle image slice synchronization with proper configuration for volume viewports
 */
export async function toggleHeatmapImageSliceSync({ servicesManager }): Promise<void> {
  const { viewportGridService } = servicesManager.services;

  if (syncableViewports(viewportGridService).length < 2) {
    console.warn('[HeatmapSync] Need at least 2 viewports to sync');
    return;
  }

  if (isHeatmapSyncEnabled({ servicesManager })) {
    userDisabledSync = true;
    disableHeatmapImageSliceSync({ servicesManager });
    return;
  }

  userDisabledSync = false;
  await enableHeatmapImageSliceSync({ servicesManager });
}
