import { getStaticDate } from './dateCache';
import { extractAIResultData } from './extractAIResultData';
import { formatDicomDateTime } from './dicomDateTime';
import { findMatchingSRForHeatmap } from './aiResultPairing';
import {
  isAIResult,
  getRealDisplaySet,
  getCreationTzOffset,
  clearAITabCache,
  getAITabCacheSize,
} from './aiTabHelpers';

interface AIEntry {
  thumb: any;
  real: any;
  modality: string | undefined;
  modelName: string;
  formattedDateTime: string | null;
  sortKey: string;
}

/**
 * Group key for an AI entry (H-03). SR (report) display sets are keyed by
 * model + run datetime so two *different* models produced at the same DICOM
 * second stay in separate groups (previously they merged and were deleted
 * together). An SC (heatmap) joins the group of the SR it pairs with — by
 * referenced SOP UID / time proximity — so a report and its heatmap stay
 * together; an unpaired heatmap falls back to a datetime-only key. Returns
 * `null` when the entry has no usable date (handled as a missing-date group).
 */
function aiGroupKey(entry: AIEntry, srEntries: AIEntry[]): string | null {
  if (!entry.formattedDateTime) {
    return null;
  }
  if (entry.modality === 'SC') {
    const matchSR = findMatchingSRForHeatmap(
      entry.real,
      srEntries.map(s => s.real)
    );
    const paired = matchSR ? srEntries.find(s => s.real === matchSR) : undefined;
    if (paired && paired.formattedDateTime) {
      return `${paired.modelName}|${paired.formattedDateTime}`;
    }
    return `AI Model|${entry.formattedDateTime}`;
  }
  return `${entry.modelName}|${entry.formattedDateTime}`;
}

/**
 * Creates tabs for the study browser that groups AI results by model name + datetime
 * @param {string[]} primaryStudyInstanceUIDs
 * @param {object[]} studyDisplayList
 * @param {object[]} displaySets - These are thumbnail objects, not actual display sets
 * @param {object} servicesManager - Needed to access displaySetService for real data
 * @returns tabs - The prop object expected by the StudyBrowser component
 */
export function createAIBrowserTabs(
  primaryStudyInstanceUIDs,
  studyDisplayList,
  displaySets,
  servicesManager: any = null
) {
  // Group display sets
  const originalSeries = new Map();
  const aiResultGroups = new Map(); // Key: "modelName|datetime", Value: series data
  const missingDateGroups = new Map(); // Key: 'UNKNOWN', Value: series data

  // First pass: split original series from AI results, resolving each AI
  // thumbnail's real display set (instance metadata) once.
  const aiEntries: AIEntry[] = [];
  displaySets.forEach(thumbnailDisplaySet => {
    if (isAIResult(thumbnailDisplaySet)) {
      const realDisplaySet = getRealDisplaySet(thumbnailDisplaySet, servicesManager);
      const aiResultData = extractAIResultData(realDisplaySet);
      const modelName = aiResultData?.modelInfo?.name || 'AI Model';
      const creationDate = realDisplaySet?.instance?.InstanceCreationDate;
      const creationTime = realDisplaySet?.instance?.InstanceCreationTime;
      const tzOffset = getCreationTzOffset(realDisplaySet);
      aiEntries.push({
        thumb: thumbnailDisplaySet,
        real: realDisplaySet,
        modality:
          realDisplaySet?.Modality || thumbnailDisplaySet.Modality || thumbnailDisplaySet.modality,
        modelName,
        formattedDateTime: formatDicomDateTime(creationDate, creationTime, tzOffset),
        sortKey: `${creationDate || '99999999'}${creationTime || '999999'}`,
      });
    } else {
      // Original (non-AI) series
      const seriesKey = `${thumbnailDisplaySet.StudyInstanceUID}_${thumbnailDisplaySet.seriesNumber || thumbnailDisplaySet.SeriesInstanceUID}`;

      if (!originalSeries.has(seriesKey)) {
        originalSeries.set(seriesKey, {
          studyInstanceUid: thumbnailDisplaySet.StudyInstanceUID,
          date: thumbnailDisplaySet.seriesDate || getStaticDate(thumbnailDisplaySet),
          description: thumbnailDisplaySet.description || 'Series',
          modalities: thumbnailDisplaySet.modality || '',
          numInstances: 0,
          displaySets: [],
        });
      }

      const series = originalSeries.get(seriesKey);
      series.displaySets.push(thumbnailDisplaySet);
      series.numInstances += thumbnailDisplaySet.numInstances || 1;
    }
  });

  // Second pass: assign AI entries to groups. Process SR (report) entries first
  // so each group's identity/order is anchored by its report and heatmaps
  // resolve against a fully-populated SR list.
  const srEntries = aiEntries.filter(e => e.modality === 'SR');
  const orderedEntries = [...srEntries, ...aiEntries.filter(e => e.modality !== 'SR')];

  orderedEntries.forEach(entry => {
    const groupKey = aiGroupKey(entry, srEntries);

    if (groupKey === null) {
      const missingGroupKey = 'UNKNOWN';
      if (!missingDateGroups.has(missingGroupKey)) {
        missingDateGroups.set(missingGroupKey, {
          studyInstanceUid: `${entry.thumb.StudyInstanceUID}_AI_UNKNOWN`.replace(
            /[^a-zA-Z0-9._-]/g,
            '_'
          ),
          date: 'Date Unknown',
          description: `AI Results - Date Unknown`,
          modalities: 'AI',
          numInstances: 0,
          displaySets: [],
          modelName: entry.modelName,
        });
      }
      const group = missingDateGroups.get(missingGroupKey);
      group.displaySets.push(entry.thumb);
      group.numInstances += entry.thumb.numInstances || 1;
      return;
    }

    if (!aiResultGroups.has(groupKey)) {
      // A group is created by the first entry seen for the key — an SR when one
      // exists, so the label carries the report's model name for disambiguation.
      const named = entry.modelName && entry.modelName !== 'AI Model';
      aiResultGroups.set(groupKey, {
        studyInstanceUid: `${entry.thumb.StudyInstanceUID}_AI_${groupKey}`.replace(
          /[^a-zA-Z0-9._-]/g,
          '_'
        ),
        date: entry.formattedDateTime,
        description: named
          ? `${entry.modelName} - ${entry.formattedDateTime}`
          : `AI Results - ${entry.formattedDateTime}`,
        modalities: 'AI',
        numInstances: 0,
        displaySets: [],
        modelName: entry.modelName,
        sortKey: entry.sortKey,
      });
    }

    const group = aiResultGroups.get(groupKey);
    group.displaySets.push(entry.thumb);
    group.numInstances += entry.thumb.numInstances || 1;
  });

  // Create tabs in the specified order
  const tabs: any[] = [];

  // 1. Original tab (always first)
  if (originalSeries.size > 0) {
    tabs.push({
      name: 'original',
      label: 'Original',
      studies: Array.from(originalSeries.values()),
    });
  }

  // 2. AI results tabs sorted by datetime
  const sortedAIGroups = Array.from(aiResultGroups.values()).sort((a, b) => {
    return a.sortKey.localeCompare(b.sortKey);
  });

  sortedAIGroups.forEach((group, index) => {
    tabs.push({
      name: `ai-${index}`,
      label: group.description,
      studies: [group],
    });
  });

  // 3. Missing date tabs grouped by model
  Array.from(missingDateGroups.values()).forEach((group, index) => {
    tabs.push({
      name: `ai-missing-${index}`,
      label: group.description,
      studies: [group],
    });
  });

  // 4. All tab (if there are multiple tabs)
  if (tabs.length > 1) {
    const allStudies = [
      ...Array.from(originalSeries.values()),
      ...sortedAIGroups,
      ...Array.from(missingDateGroups.values()),
    ];

    tabs.push({
      name: 'all',
      label: 'All',
      studies: allStudies,
    });
  }

  return tabs;
}

/**
 * Clear the display set cache to prevent memory leaks. Delegates to the shared cache in
 * aiTabHelpers; kept as a named export for existing callers and tests.
 */
export function clearDisplaySetCache() {
  clearAITabCache();
}

/**
 * Get cache size for debugging. Delegates to the shared cache in aiTabHelpers.
 */
export function getDisplaySetCacheSize() {
  return getAITabCacheSize();
}
