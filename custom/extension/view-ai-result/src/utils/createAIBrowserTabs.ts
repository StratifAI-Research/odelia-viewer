import { getStaticDate } from './dateCache';
import { extractAIResultData } from './extractAIResultData';
import { formatDicomDateTime, creationSortKey } from './dicomDateTime';
import {
  isAIResult,
  getRealDisplaySet,
  getCreationTzOffset,
  resolveAIGroupIdentity,
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
 * Creates tabs for the study browser that groups AI results by report identity.
 * Each group is keyed by the SR (report) SOP Instance UID (ODV-223), so two runs
 * that share a model and a creation second stay separate; a heatmap (SC) joins
 * the group of the SR it pairs with (referenced SOP UID / time proximity).
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
  // Both keyed by report identity (SR SOP Instance UID); whether an entry has a
  // usable date decides which map holds its group. Value: series data.
  const aiResultGroups = new Map();
  const missingDateGroups = new Map();

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
        // Sort by the true UTC instant so display order matches the labeled
        // timestamps even across mixed offsets (ODV-223).
        sortKey: creationSortKey(creationDate, creationTime, tzOffset),
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

  // Second pass: assign AI entries to groups keyed by report SOP Instance UID
  // (ODV-223). Process SR (report) entries first so each group is created and
  // labeled from its report, and heatmaps resolve against a fully-populated SR
  // list. An entry whose identity already has a group (its report was seen
  // first) joins that group regardless of its own date, so a dateless heatmap
  // still stays with its dated report.
  const srEntries = aiEntries.filter(e => e.modality === 'SR');
  // Index SR display sets by study so a heatmap only ever pairs with a report
  // from its OWN study (this flat builder can receive multiple studies at once).
  const srRealByStudy = new Map<string, any[]>();
  srEntries.forEach(e => {
    const sid = e.thumb.StudyInstanceUID;
    if (!srRealByStudy.has(sid)) {
      srRealByStudy.set(sid, []);
    }
    srRealByStudy.get(sid)!.push(e.real);
  });
  const orderedEntries = [...srEntries, ...aiEntries.filter(e => e.modality !== 'SR')];

  const sanitize = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, '_');

  orderedEntries.forEach(entry => {
    const sameStudySrReal = srRealByStudy.get(entry.thumb.StudyInstanceUID) || [];
    const { key: identity } = resolveAIGroupIdentity(entry.real, sameStudySrReal);

    // Join an existing group for this identity (dated or missing-date) if one
    // was already created by its report.
    const existing = aiResultGroups.get(identity) || missingDateGroups.get(identity);
    if (existing) {
      existing.displaySets.push(entry.thumb);
      existing.numInstances += entry.thumb.numInstances || 1;
      return;
    }

    if (!entry.formattedDateTime) {
      // New missing-date group — keyed by identity so distinct dateless reports
      // are not merged together.
      const group = {
        studyInstanceUid: sanitize(`${entry.thumb.StudyInstanceUID}_AI_${identity}_UNKNOWN`),
        date: 'Date Unknown',
        description: `AI Results - Date Unknown`,
        modalities: 'AI',
        numInstances: entry.thumb.numInstances || 1,
        displaySets: [entry.thumb],
        modelName: entry.modelName,
      };
      missingDateGroups.set(identity, group);
      return;
    }

    // New dated group. The creating entry is an SR when one exists, so the label
    // carries the report's model name for disambiguation.
    const named = entry.modelName && entry.modelName !== 'AI Model';
    aiResultGroups.set(identity, {
      studyInstanceUid: sanitize(`${entry.thumb.StudyInstanceUID}_AI_${identity}`),
      date: entry.formattedDateTime,
      description: named
        ? `${entry.modelName} - ${entry.formattedDateTime}`
        : `AI Results - ${entry.formattedDateTime}`,
      modalities: 'AI',
      numInstances: entry.thumb.numInstances || 1,
      displaySets: [entry.thumb],
      modelName: entry.modelName,
      sortKey: entry.sortKey,
    });
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

  // 3. Missing-date tabs — one per report identity, so distinct dateless
  //    reports stay in separate tabs rather than merging into one bucket
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
