import alignHeatmapSlice from './alignHeatmapSlice';
import { haveSopIdentityLink } from './aiResultPairing';

const HEATMAP_SYNC_ID = 'HEATMAP_IMAGE_SLICE_SYNC';

/** Modalities an ODELIA AI result arrives as. Used only to assign ROLES within an already
 *  DICOM-linked pair -- never on its own to decide that two viewports are related. */
const AI_RESULT_MODALITIES = new Set(['SC', 'SR']);

/**
 * Whether the reader switched sync off by hand, per servicesManager.
 *
 * ensureHeatmapImageSliceSync() turns sync on automatically and fires on every grid change, so
 * without this it would immediately undo a manual switch-off and the toggle would look broken.
 * Keyed on the servicesManager rather than a module-level boolean, which every viewer in the
 * realm would share; a WeakMap also lets the entry be collected with the viewer.
 */
const userDisabledSync = new WeakMap<object, boolean>();

/** In-flight enable per viewer, so overlapping grid events cannot interleave two attempts. */
const inFlight = new WeakMap<object, Promise<boolean>>();

export const isHeatmapSyncUserDisabled = ({ servicesManager }): boolean =>
  userDisabledSync.get(servicesManager) === true;

export const resetHeatmapSyncPreference = ({ servicesManager }): void => {
  userDisabledSync.delete(servicesManager);
};

const syncableViewports = viewportGridService =>
  Array.from(viewportGridService.getState().viewports.values()).filter(
    (vp: any) => vp.displaySetInstanceUIDs?.length > 0
  );

const viewportIdOf = (gridViewport: any) => gridViewport.viewportOptions?.viewportId;

const displaySetsOf = (displaySetService, gridViewport: any) =>
  (gridViewport.displaySetInstanceUIDs || [])
    .map(uid => displaySetService?.getDisplaySetByUID?.(uid))
    .filter(Boolean);

const isAIResult = (displaySets: any[]) =>
  displaySets.some(ds => AI_RESULT_MODALITIES.has(ds?.Modality));

export type SyncPair = { primaryViewportId: string; heatmapViewportId: string };

/**
 * The ONE primary/heatmap pair to couple, or null.
 *
 * Two conditions, and both matter. Relatedness comes from the DICOM: haveSopIdentityLink walks
 * one display set's referenced SOP Instance UIDs against the other's own UIDs. For this study
 * the heatmap's ReferencedImageSequence names an MR instance belonging to the MR series, so the
 * link resolves. A modality test alone would couple any incidental screenshot or report sitting
 * in the study; modality is used only to decide which side of a linked pair is the AI result.
 *
 * Returning a PAIR, not a predicate, is the point: the previous version asked whether *any* two
 * viewports were linked and then added *every* populated viewport to the group, so one valid
 * pair in a three-viewport layout dragged an unrelated third viewport in with it.
 */
export function resolveSyncPair({ servicesManager }): SyncPair | null {
  const { viewportGridService, displaySetService } = servicesManager.services;
  const viewportArray = syncableViewports(viewportGridService);

  for (let i = 0; i < viewportArray.length; i++) {
    for (let j = i + 1; j < viewportArray.length; j++) {
      const a = viewportArray[i] as any;
      const b = viewportArray[j] as any;
      const dsA = displaySetsOf(displaySetService, a);
      const dsB = displaySetsOf(displaySetService, b);

      const linked = dsA.some(x => dsB.some(y => x !== y && haveSopIdentityLink(x, y)));

      if (!linked) {
        continue;
      }

      const aIsResult = isAIResult(dsA);
      const bIsResult = isAIResult(dsB);

      // Exactly one side must be the AI result; two results, or none, is not a pair this
      // feature understands.
      if (aIsResult === bIsResult) {
        continue;
      }

      return aIsResult
        ? { primaryViewportId: viewportIdOf(b), heatmapViewportId: viewportIdOf(a) }
        : { primaryViewportId: viewportIdOf(a), heatmapViewportId: viewportIdOf(b) };
    }
  }

  return null;
}

const inGroup = (syncGroupService, viewportId: string) =>
  (syncGroupService.getSynchronizersForViewport(viewportId) || []).some(
    s => s.id === HEATMAP_SYNC_ID
  );

/** True when ANY viewport is in the heatmap sync group -- the toggle's on/off question. */
export function isHeatmapSyncEnabled({ servicesManager }): boolean {
  const { syncGroupService, viewportGridService } = servicesManager.services;

  return syncableViewports(viewportGridService).some((vp: any) =>
    inGroup(syncGroupService, viewportIdOf(vp))
  );
}

/**
 * True when the resolved PAIR -- not merely some set of viewports -- is in the group.
 *
 * Membership-only-over-all-viewports was wrong twice: it treated a half-built group as done
 * (opening the heatmap recreates the first viewport's cornerstone instance and silently drops
 * it, measured at 16.50 mm apart and staying apart), and it would call a group complete that
 * contained unrelated viewports.
 */
export function isHeatmapSyncComplete({ servicesManager }): boolean {
  const { syncGroupService } = servicesManager.services;
  const pair = resolveSyncPair({ servicesManager });

  if (!pair) {
    return false;
  }

  return (
    inGroup(syncGroupService, pair.primaryViewportId) &&
    inGroup(syncGroupService, pair.heatmapViewportId)
  );
}

/**
 * Couple the primary series to its heatmap.
 *
 * Order matters: preflight and ALIGN first, install membership last. An earlier version added
 * every viewport to the group and then aligned, so a failed alignment left a group that
 * reported as complete but was not aligned -- and the automatic path, seeing "complete", never
 * retried it. Aligning first means there is nothing to undo when alignment is refused.
 *
 * Roles are one-way on purpose: primary is source-only, heatmap target-only. Registering both
 * as source and target advertised a reverse direction (scroll the heatmap, move the MR) that
 * silently did nothing, because a volume target is refused. One-way is honest about what works.
 */
export async function enableHeatmapImageSliceSync({ servicesManager }): Promise<boolean> {
  const { syncGroupService, cornerstoneViewportService } = servicesManager.services;
  const pair = resolveSyncPair({ servicesManager });

  if (!pair) {
    console.warn('[HeatmapSync] no primary/heatmap pair to sync');
    return false;
  }

  const primary = cornerstoneViewportService.getCornerstoneViewport(pair.primaryViewportId);
  const heatmap = cornerstoneViewportService.getCornerstoneViewport(pair.heatmapViewportId);

  if (!primary || !heatmap) {
    // A grid change lands before the cornerstone viewports behind it exist; a later event
    // retries. Nothing has been mutated, so there is nothing to undo.
    return false;
  }

  const outcome = await alignHeatmapSlice(primary, heatmap, {
    sourceViewportId: pair.primaryViewportId,
    targetViewportId: pair.heatmapViewportId,
  });

  if (outcome.status === 'unsupported' || outcome.status === 'failed') {
    console.warn(`[HeatmapSync] not syncing: ${outcome.reason}`);
    return false;
  }

  const added: Array<{ viewportId: string; renderingEngineId: string }> = [];

  const add = (viewportId: string, viewport: any, source: boolean, target: boolean) => {
    const renderingEngineId = viewport.getRenderingEngine().id;
    syncGroupService.addViewportToSyncGroup(viewportId, renderingEngineId, {
      type: 'heatmapImageSlice',
      id: HEATMAP_SYNC_ID,
      source,
      target,
    });
    added.push({ viewportId, renderingEngineId });
  };

  try {
    add(pair.primaryViewportId, primary, true, false);
    add(pair.heatmapViewportId, heatmap, false, true);
  } catch (error) {
    added.forEach(({ viewportId, renderingEngineId }) =>
      syncGroupService.removeViewportFromSyncGroup(viewportId, renderingEngineId, HEATMAP_SYNC_ID)
    );
    console.warn('[HeatmapSync] could not install sync roles, undone:', error);
    return false;
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
 * Turn sync on automatically once the heatmap opens beside its primary series, unless the
 * reader turned it off.
 *
 * Safe on every GRID_STATE_CHANGED: it bails out early on each condition, is a cheap no-op once
 * the pair is synced, and serialises concurrent attempts so two grid events in quick succession
 * cannot both run the enable path.
 */
export async function ensureHeatmapImageSliceSync({ servicesManager }): Promise<void> {
  if (isHeatmapSyncUserDisabled({ servicesManager })) {
    return;
  }

  if (isHeatmapSyncComplete({ servicesManager })) {
    return;
  }

  if (!resolveSyncPair({ servicesManager })) {
    return;
  }

  const running = inFlight.get(servicesManager);

  if (running) {
    await running;
    return;
  }

  const attempt = enableHeatmapImageSliceSync({ servicesManager }).finally(() =>
    inFlight.delete(servicesManager)
  );
  inFlight.set(servicesManager, attempt);
  await attempt;
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
    userDisabledSync.set(servicesManager, true);
    disableHeatmapImageSliceSync({ servicesManager });
    return;
  }

  userDisabledSync.set(servicesManager, false);
  await enableHeatmapImageSliceSync({ servicesManager });
}
