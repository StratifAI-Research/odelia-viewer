import { getStaticDate, dateSortKey } from './dateCache';
import { extractAIResultData } from './extractAIResultData';
import { findMatchingSRForHeatmap } from './aiResultPairing';
import {
  isAIResult,
  getRealDisplaySet,
  formatCreationDateTime,
  clearAITabCache,
} from './aiTabHelpers';

/**
 * Build a nested tab structure with a single "All Studies" tab containing all studies.
 * Each study contains:
 *   – `originals` array: non-AI series displayed flat
 *   – `aiGroups` array: AI results grouped by InstanceCreationDateTime, each collapsible
 *
 * This structure allows all studies to be visible in one panel with collapsible sections.
 */
export function createStudyAIBrowserTabsNested(
  primaryStudyInstanceUIDs: string[],
  studyDisplayList: any[],
  displaySets: any[],
  servicesManager: any = null
) {
  // Index studies by StudyInstanceUID for quick metadata look-up
  const studyMetaByUID = new Map<string, any>();
  studyDisplayList.forEach(studyMeta => {
    studyMetaByUID.set(studyMeta.studyInstanceUid, studyMeta);
  });

  // Group displaySets by their owning study for further processing.
  const displaySetsByStudy = new Map<string, any[]>();
  displaySets.forEach(ds => {
    const sid = ds.StudyInstanceUID || ds.studyInstanceUID;
    if (!displaySetsByStudy.has(sid)) {
      displaySetsByStudy.set(sid, []);
    }
    displaySetsByStudy.get(sid)!.push(ds);
  });

  const allStudies: any[] = [];

  // Iterate over all known studies (from metadata list or from displaySets)
  const studyUIDs = Array.from(
    new Set<string>([...displaySetsByStudy.keys(), ...studyMetaByUID.keys()])
  );

  studyUIDs.forEach(studyUID => {
    const meta = studyMetaByUID.get(studyUID) || {
      studyInstanceUid: studyUID,
      date: undefined,
      description: 'Study',
      modalities: '',
      numInstances: 0,
    };

    const studyDisplaySets = displaySetsByStudy.get(studyUID) || [];

    // -------------- Build groups --------------
    const originals: any[] = [];
    const aiGroupsMap = new Map<string, any>();

    // Collect AI entries (resolving each real display set once) and originals.
    const aiEntries = studyDisplaySets.reduce<any[]>((acc, thumbDS) => {
      if (isAIResult(thumbDS)) {
        const realDS = getRealDisplaySet(thumbDS, servicesManager);
        acc.push({
          thumb: thumbDS,
          real: realDS,
          modality: realDS?.Modality || thumbDS.Modality || thumbDS.modality,
          modelName: extractAIResultData(realDS)?.modelInfo?.name || 'AI Model',
          dateTime: formatCreationDateTime(realDS),
        });
      } else {
        originals.push(thumbDS);
      }
      return acc;
    }, []);

    // Key SR (report) entries by model + datetime so two different models at the
    // same instant stay in separate groups; a heatmap (SC) joins the group of
    // the SR it pairs with by referenced UID / time proximity (H-03). Process
    // SRs first so a group's model identity comes from its report.
    const srEntries = aiEntries.filter(e => e.modality === 'SR');
    const orderedEntries = [...srEntries, ...aiEntries.filter(e => e.modality !== 'SR')];

    const keyForEntry = (entry: any): { key: string; dateTime: string | null; modelName: string } => {
      if (entry.modality === 'SC') {
        const matchSR = findMatchingSRForHeatmap(entry.real, srEntries.map(s => s.real));
        const paired = matchSR ? srEntries.find(s => s.real === matchSR) : undefined;
        if (paired) {
          const key = paired.dateTime
            ? `${paired.modelName}|${paired.dateTime}`
            : `UNKNOWN_${paired.real.displaySetInstanceUID}`;
          return { key, dateTime: paired.dateTime, modelName: paired.modelName };
        }
        const key = entry.dateTime ? `AI Model|${entry.dateTime}` : `UNKNOWN_${entry.real.displaySetInstanceUID}`;
        return { key, dateTime: entry.dateTime, modelName: 'AI Model' };
      }
      const key = entry.dateTime
        ? `${entry.modelName}|${entry.dateTime}`
        : `UNKNOWN_${entry.real.displaySetInstanceUID}`;
      return { key, dateTime: entry.dateTime, modelName: entry.modelName };
    };

    orderedEntries.forEach(entry => {
      const { key, dateTime, modelName } = keyForEntry(entry);
      if (!aiGroupsMap.has(key)) {
        aiGroupsMap.set(key, {
          key,
          dateTime,
          displaySets: [],
          sortKey: dateTime || '00000000',
          modelName,
          label: `${modelName || 'AI Model'}\n${dateTime || 'Unknown Date'}`,
        });
      }
      aiGroupsMap.get(key).displaySets.push(entry.thumb);
    });

    const aiGroups = Array.from(aiGroupsMap.values()).sort((a,b)=>a.sortKey.localeCompare(b.sortKey));

    // -------------- Build study object --------------
    allStudies.push({
      ...meta,
      originals,
      aiGroups,
      studyInstanceUid: studyUID,
      date: meta.date || getStaticDate(studyDisplaySets[0]),
    });
  });

  // Sort studies – primary first, then by date desc
  const primarySet = new Set(primaryStudyInstanceUIDs);
  allStudies.sort((a, b) => {
    const aPrimary = primarySet.has(a.studyInstanceUid) ? 0 : 1;
    const bPrimary = primarySet.has(b.studyInstanceUid) ? 0 : 1;
    if (aPrimary !== bPrimary) return aPrimary - bPrimary;
    // if both same category, newest date first (VAR-N6: engine-independent key)
    return dateSortKey(b.date) - dateSortKey(a.date);
  });

  // Return single tab containing all studies
  return [
    {
      name: 'all',
      label: 'All Studies',
      studies: allStudies,
    },
  ];
}

export function clearNestedTabCache() {
  clearAITabCache();
}
