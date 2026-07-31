import { getStaticDate, dateSortKey } from './dateCache';
import { extractAIResultData } from './extractAIResultData';
import { creationSortKey } from './dicomDateTime';
import {
  isAIResult,
  getRealDisplaySet,
  getCreationTzOffset,
  formatCreationDateTime,
  resolveAIGroupIdentity,
} from './aiTabHelpers';

/**
 * Build a nested tab structure with a single "All Studies" tab containing all studies.
 * Each study contains:
 *   – `originals` array: non-AI series displayed flat
 *   – `aiGroups` array: AI results grouped by report SR SOP Instance UID, each collapsible
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
        const creationDate = realDS?.instance?.InstanceCreationDate;
        const creationTime = realDS?.instance?.InstanceCreationTime;
        acc.push({
          thumb: thumbDS,
          real: realDS,
          modality: realDS?.Modality || thumbDS.Modality || thumbDS.modality,
          modelName: extractAIResultData(realDS)?.modelInfo?.name || 'AI Model',
          dateTime: formatCreationDateTime(realDS),
          // Sort by the true UTC instant — timezone-independent and consistent
          // with the labeled display order, not the localized string (ODV-223).
          sortKey: creationSortKey(creationDate, creationTime, getCreationTzOffset(realDS)),
        });
      } else {
        originals.push(thumbDS);
      }
      return acc;
    }, []);

    // Key each group by its report's SOP Instance UID (ODV-223): two runs that
    // share a model and creation second stay in separate groups, and a heatmap
    // (SC) joins the group of the SR it pairs with. Process SRs first so each
    // group is created — and its label/date/sort taken — from its report.
    const srEntries = aiEntries.filter(e => e.modality === 'SR');
    const srReal = srEntries.map(e => e.real);
    const orderedEntries = [...srEntries, ...aiEntries.filter(e => e.modality !== 'SR')];

    orderedEntries.forEach(entry => {
      const { key } = resolveAIGroupIdentity(entry.real, srReal);
      if (!aiGroupsMap.has(key)) {
        aiGroupsMap.set(key, {
          key,
          dateTime: entry.dateTime,
          displaySets: [],
          sortKey: entry.sortKey,
          modelName: entry.modelName,
          label: `${entry.modelName || 'AI Model'}\n${entry.dateTime || 'Unknown Date'}`,
        });
      }
      aiGroupsMap.get(key).displaySets.push(entry.thumb);
    });

    const aiGroups = Array.from(aiGroupsMap.values()).sort((a, b) =>
      a.sortKey.localeCompare(b.sortKey)
    );

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
    if (aPrimary !== bPrimary) {
      return aPrimary - bPrimary;
    }
    // if both same category, newest date first (engine-independent key)
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
