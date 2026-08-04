import alignHeatmapSlice from './alignHeatmapSlice';
import { haveSopIdentityLink } from './aiResultPairing';

const HEATMAP_SYNC_ID = 'HEATMAP_IMAGE_SLICE_SYNC';

/**
 * Whether the reader switched sync off by hand, per servicesManager.
 *
 * ensureHeatmapImageSliceSync() turns sync on automatically and fires on every grid change, so
 * without this it would immediately undo a manual switch-off and the toggle would look broken.
 *
 * Keyed on the servicesManager rather than held as a module-level boolean: a module global is
 * shared by every viewer in the JS realm, so two viewer roots -- or a mode being entered while
 * another is still exiting -- would read and clobber each other's preference. A WeakMap also
 * means the entry disappears with the viewer instead of leaking.
 */
const userDisabledSync = new WeakMap<object, boolean>();

export const isHeatmapSyncUserDisabled = ({ servicesManager }): boolean =>
  userDisabledSync.get(servicesManager) === true;

export const resetHeatmapSyncPreference = ({ servicesManager }): void => {
  userDisabledSync.delete(servicesManager);
};

const setUserDisabled = (servicesManager, disabled: boolean): void => {
  userDisabledSync.set(servicesManager, disabled);
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

const displaySetsOf = (displaySetService, gridViewport: any) =>
  (gridViewport.displaySetInstanceUIDs || [])
    .map(uid => displaySetService?.getDisplaySetByUID?.(uid))
    .filter(Boolean);

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
 * Whether two viewports show display sets that are actually related.
 *
 * A modality test ("is either an SC or an SR") is not good enough: those modalities are
 * generic, so an unrelated screenshot or report sitting in the same study would auto-link
 * viewports the reader never asked to couple. This asks the DICOM instead --
 * haveSopIdentityLink walks one display set's referenced SOP Instance UIDs against the
 * other's own UIDs.
 *
 * That resolves for this study family: the heatmap's ReferencedImageSequence names both an MR
 * Image Storage instance (1.2.840.10008.5.1.4.1.1.4) belonging to the MR series and the SR
 * document, so heatmap<->MR and heatmap<->SR both link. Note the convenience wrappers in
 * aiResultPairing (findMatchingHeatmap / findMatchingSRForHeatmap) pair SR to SC only and are
 * deliberately NOT used here -- the primitive is what generalises to the primary series.
 */
const arePaired = (displaySetService, a: any, b: any): boolean => {
  const dsA = displaySetsOf(displaySetService, a);
  const dsB = displaySetsOf(displaySetService, b);

  return dsA.some(x => dsB.some(y => x !== y && haveSopIdentityLink(x, y)));
};

/**
 * Add every populated viewport to the heatmap sync group, then align them straight away.
 *
 * addViewportToSyncGroup only arms the synchronizer for the NEXT slice-change event, so on
 * its own it leaves the newly opened heatmap on whichever slice it loaded at -- the reader
 * had to scroll before anything lined up. The explicit alignHeatmapSlice pass is what makes
 * enabling sync take effect at the moment it is enabled.
 *
 * All-or-nothing: if the initial alignment fails, the viewports added here are removed again.
 * Leaving a built-but-unaligned group behind is the worst outcome -- it reports as synced, so
 * the automatic path treats it as done and never retries, while the viewports disagree.
 */
export async function enableHeatmapImageSliceSync({ servicesManager }): Promise<boolean> {
  const { syncGroupService, cornerstoneViewportService, viewportGridService } =
    servicesManager.services;

  const viewportArray = syncableViewports(viewportGridService);

  if (viewportArray.length < 2) {
    console.warn('[HeatmapSync] Need at least 2 viewports to sync');
    return false;
  }

  const added: Array<{ viewportId: string; renderingEngineId: string }> = [];

  viewportArray.forEach((gridViewport: any) => {
    const viewportId = viewportIdOf(gridViewport);
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportId);

    if (!viewport) {
      console.warn('[HeatmapSync] Viewport not found:', viewportId);
      return;
    }

    const renderingEngineId = viewport.getRenderingEngine().id;

    syncGroupService.addViewportToSyncGroup(viewportId, renderingEngineId, {
      type: 'heatmapImageSlice',
      id: HEATMAP_SYNC_ID,
      source: true,
      target: true,
    });
    added.push({ viewportId, renderingEngineId });
  });

  const rollback = () =>
    added.forEach(({ viewportId, renderingEngineId }) =>
      syncGroupService.removeViewportFromSyncGroup(viewportId, renderingEngineId, HEATMAP_SYNC_ID)
    );

  // The active viewport is the one the reader is driving, so it is the source everything
  // else lines up to.
  const activeViewportId = viewportGridService.getState().activeViewportId;
  const source = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);

  if (!source) {
    rollback();
    return false;
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
      console.warn('[HeatmapSync] initial alignment failed, undoing sync group:', error);
      rollback();
      return false;
    }
  }

  return true;
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
 * Turn sync on automatically once a second viewport shows a RELATED AI result, unless the
 * reader turned it off.
 *
 * Written to be safe on every GRID_STATE_CHANGED, which fires often: it bails out early on
 * each condition below rather than doing work, and once sync is complete the
 * isHeatmapSyncComplete() check makes it a cheap no-op.
 */
export async function ensureHeatmapImageSliceSync({ servicesManager }): Promise<void> {
  const { viewportGridService, cornerstoneViewportService, displaySetService } =
    servicesManager.services;

  if (isHeatmapSyncUserDisabled({ servicesManager })) {
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

  // Only couple viewports whose display sets are actually related -- see arePaired. Two
  // unrelated series, or an incidental screenshot, are left alone.
  const hasRelatedPair = viewportArray.some((a: any, i: number) =>
    viewportArray.slice(i + 1).some((b: any) => arePaired(displaySetService, a, b))
  );

  if (!hasRelatedPair) {
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
    setUserDisabled(servicesManager, true);
    disableHeatmapImageSliceSync({ servicesManager });
    return;
  }

  setUserDisabled(servicesManager, false);
  await enableHeatmapImageSliceSync({ servicesManager });
}
