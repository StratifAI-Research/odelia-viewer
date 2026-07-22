import { getStaticDate } from './dateCache';
import { extractAIResultData } from './extractAIResultData';
import { formatDicomDateTime } from './dicomDateTime';
import {
  isAIResult,
  getRealDisplaySet,
  getCreationTzOffset,
  clearAITabCache,
  getAITabCacheSize,
} from './aiTabHelpers';

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
  const missingDateGroups = new Map(); // Key: modelName, Value: series data

  displaySets.forEach(thumbnailDisplaySet => {
    if (isAIResult(thumbnailDisplaySet)) {
      // Get the real display set with instance data
      const realDisplaySet = getRealDisplaySet(thumbnailDisplaySet, servicesManager);

      // Extract AI model info
      const aiResultData = extractAIResultData(realDisplaySet);
      const modelName = aiResultData?.modelInfo?.name || 'AI Model';

      // Extract creation date/time and possible timezone offset from real display set
      const creationDate = realDisplaySet?.instance?.InstanceCreationDate;
      const creationTime = realDisplaySet?.instance?.InstanceCreationTime;
      const tzOffset = getCreationTzOffset(realDisplaySet);

      const formattedDateTime = formatDicomDateTime(creationDate, creationTime, tzOffset);

      if (formattedDateTime) {
        // Group by datetime ONLY (both SC and SR from same run together)
        const groupKey = formattedDateTime;

        if (!aiResultGroups.has(groupKey)) {
          aiResultGroups.set(groupKey, {
            studyInstanceUid: `${thumbnailDisplaySet.StudyInstanceUID}_AI_${formattedDateTime}`.replace(/[^a-zA-Z0-9._-]/g, '_'),
            date: formattedDateTime,
            description: `AI Results - ${formattedDateTime}`,
            modalities: 'AI',
            numInstances: 0,
            displaySets: [],
            modelName,
            sortKey: `${creationDate || '99999999'}${creationTime || '999999'}` // For sorting
          });
        }

        const group = aiResultGroups.get(groupKey);
        group.displaySets.push(thumbnailDisplaySet);
        group.numInstances += thumbnailDisplaySet.numInstances || 1;
            } else {
        // Group missing dates together (both SC and SR together)

        const missingGroupKey = 'UNKNOWN';

        if (!missingDateGroups.has(missingGroupKey)) {
          missingDateGroups.set(missingGroupKey, {
            studyInstanceUid: `${thumbnailDisplaySet.StudyInstanceUID}_AI_UNKNOWN`.replace(/[^a-zA-Z0-9._-]/g, '_'),
            date: 'Date Unknown',
            description: `AI Results - Date Unknown`,
            modalities: 'AI',
            numInstances: 0,
            displaySets: [],
            modelName
          });
        }

        const group = missingDateGroups.get(missingGroupKey);
        group.displaySets.push(thumbnailDisplaySet);
        group.numInstances += thumbnailDisplaySet.numInstances || 1;
      }
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
      ...Array.from(missingDateGroups.values())
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
