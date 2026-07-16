import { formatDicomDateTime } from './dicomDateTime';

/**
 * Shared helpers for the AI study-browser tab builders — the flat `createAIBrowserTabs`
 * and the nested `createStudyAIBrowserTabsNested`. Both classify thumbnails, resolve them
 * to real display sets (an expensive service lookup) and format creation date/time
 * identically, so that logic — including the module-level resolution cache — lives here
 * once instead of being duplicated in each builder.
 */

// Cache for expensive display set lookups — key: displaySetInstanceUID, value: realDisplaySet.
// VAR-M11: bounded so it cannot grow unbounded across a session; `clearAITabCache()`
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
    result = dss.getDisplaySetByUID(thumbnailDisplaySet.displaySetInstanceUID) || thumbnailDisplaySet;
  } catch (error) {
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
 * Format a display set's InstanceCreation date/time (respecting its TZ offset) as
 * "YYYY-MM-DD HH:MM:SS", or null when there is no creation date.
 */
export function formatCreationDateTime(realDisplaySet: any): string | null {
  return formatDicomDateTime(
    realDisplaySet?.instance?.InstanceCreationDate,
    realDisplaySet?.instance?.InstanceCreationTime,
    getCreationTzOffset(realDisplaySet)
  );
}

/** Clear the shared resolution cache (call when display sets change / on teardown). */
export function clearAITabCache(): void {
  displaySetCache.clear();
}

/** Current size of the shared resolution cache (debugging / test isolation). */
export function getAITabCacheSize(): number {
  return displaySetCache.size;
}
