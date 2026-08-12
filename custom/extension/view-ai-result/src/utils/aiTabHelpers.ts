import { formatDicomDateTime } from './dicomDateTime';
import { primarySopInstanceUID, findMatchingSRForHeatmap } from './aiResultPairing';

/**
 * Shared helpers for the AI study-browser tab builders — the flat `createAIBrowserTabs`
 * and the nested `createStudyAIBrowserTabsNested`. Both classify thumbnails, resolve them
 * to real display sets (an expensive service lookup), format creation date/time, and
 * derive the stable grouping identity identically, so that logic — including the
 * module-level resolution cache — lives here once instead of being duplicated in each
 * builder.
 */

// Cache for expensive display set lookups — key: displaySetInstanceUID, value: realDisplaySet.
// Bounded so it cannot grow unbounded across a session; `clearAITabCache()`
// resets it on study-lifecycle changes.
const displaySetCache = new Map<string, any>();
const MAX_DISPLAYSET_CACHE_ENTRIES = 512;

/** True when the display set is an AI artifact: SR (structured report) or SC (heatmap). */
export function isAIResult(displaySet: any): boolean {
  if (!displaySet) {
    return false;
  }
  const modality = displaySet.Modality || displaySet.modality;
  return modality === 'SR' || modality === 'SC';
}

/**
 * Resolve a thumbnail display set to the real one via displaySetService, caching the
 * result. Falls back to the thumbnail when the service is unavailable or the lookup
 * throws. Without a displaySetService the thumbnail is returned uncached, so a later
 * call that does have the service can still resolve it.
 */
export function getRealDisplaySet(thumbnailDisplaySet: any, servicesManager: any = null): any {
  const dss = servicesManager?.services?.displaySetService;
  if (!dss) {
    return thumbnailDisplaySet;
  }

  const cacheKey = thumbnailDisplaySet.displaySetInstanceUID;
  if (displaySetCache.has(cacheKey)) {
    return displaySetCache.get(cacheKey);
  }

  let result;
  try {
    result =
      dss.getDisplaySetByUID(thumbnailDisplaySet.displaySetInstanceUID) || thumbnailDisplaySet;
  } catch {
    result = thumbnailDisplaySet;
  }
  if (displaySetCache.size >= MAX_DISPLAYSET_CACHE_ENTRIES) {
    const oldest = displaySetCache.keys().next().value;
    if (oldest !== undefined) {
      displaySetCache.delete(oldest);
    }
  }
  displaySetCache.set(cacheKey, result);
  return result;
}

/** DICOM timezone offset of a display set's instance (0008,0201 / 0008,0202), or null. */
export function getCreationTzOffset(realDisplaySet: any): string | null {
  return (
    realDisplaySet?.instance?.TimezoneOffsetFromUTC ||
    realDisplaySet?.instance?.TimezoneOffset ||
    null
  );
}

/**
 * Format a display set's InstanceCreation date/time for display, following the
 * ODV-223 timezone policy in {@link formatDicomDateTime}: a labeled `… UTC` when
 * the DICOM offset `(0008,0201)` is present, a `… (timezone unknown)` wall-clock
 * when it is absent, just `YYYY-MM-DD` for a date without a time, and null when
 * there is no creation date. This value is for display only — group identity
 * keys off the SOP Instance UID (see {@link resolveAIGroupIdentity}).
 */
export function formatCreationDateTime(realDisplaySet: any): string | null {
  return formatDicomDateTime(
    realDisplaySet?.instance?.InstanceCreationDate,
    realDisplaySet?.instance?.InstanceCreationTime,
    getCreationTzOffset(realDisplaySet)
  );
}

/**
 * Stable grouping identity for an AI display set (ODV-223).
 *
 * The identity of an AI-result group is the DICOM SOP Instance UID of the
 * *report* (SR) it belongs to — never a displayed date/time string and never the
 * viewer's timezone. This is what keeps each AI run a distinct group even when
 * two runs share a model and a creation second (previously they merged into one
 * group and were deleted together).
 *
 *   - An SR is identified by its own SOP Instance UID.
 *   - An SC (heatmap) inherits the identity of the SR it pairs with — referenced
 *     SOP UID first, creation-time proximity as fallback — so a report and its
 *     heatmap always share one group.
 *   - An unpaired SC, or any display set with no readable SOP Instance UID, falls
 *     back to its own SOP UID and finally to the session-stable
 *     `displaySetInstanceUID`, so two distinct results are never collapsed.
 *
 * @param realDisplaySet    the resolved display set to place into a group
 * @param srRealDisplaySets the study's resolved SR display sets (heatmap → report lookup)
 * @returns the group key plus the display set that owns the group (an SR when one
 *          was paired, otherwise `realDisplaySet` itself)
 */
export function resolveAIGroupIdentity(
  realDisplaySet: any,
  srRealDisplaySets: any[]
): { key: string; report: any } {
  const modality = realDisplaySet?.Modality || realDisplaySet?.modality;
  if (modality === 'SC') {
    const matchSR = findMatchingSRForHeatmap(realDisplaySet, srRealDisplaySets);
    if (matchSR) {
      return { key: stableIdentity(matchSR), report: matchSR };
    }
  }
  return { key: stableIdentity(realDisplaySet), report: realDisplaySet };
}

/** SOP Instance UID if readable, else the session-stable displaySetInstanceUID, else 'UNKNOWN'. */
function stableIdentity(displaySet: any): string {
  return primarySopInstanceUID(displaySet) || displaySet?.displaySetInstanceUID || 'UNKNOWN';
}

/** Clear the shared resolution cache (call when display sets change / on teardown). */
export function clearAITabCache(): void {
  displaySetCache.clear();
}

/** Current size of the shared resolution cache (debugging / test isolation). */
export function getAITabCacheSize(): number {
  return displaySetCache.size;
}
