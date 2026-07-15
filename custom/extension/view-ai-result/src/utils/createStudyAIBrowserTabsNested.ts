import { getStaticDate } from './dateCache';
import { extractAIResultData } from './extractAIResultData';
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

    // First pass: Group AI results by datetime key
    studyDisplaySets.forEach(thumbDS => {
      if (isAIResult(thumbDS)) {
        const realDS = getRealDisplaySet(thumbDS, servicesManager);
        const dateTime = formatCreationDateTime(realDS);
        const key = dateTime || `UNKNOWN_${realDS.displaySetInstanceUID}`;

        if (!aiGroupsMap.has(key)) {
          aiGroupsMap.set(key, {
            key,
            dateTime,
            displaySets: [],
            sortKey: dateTime || '00000000',
          });
        }
        aiGroupsMap.get(key).displaySets.push(thumbDS);
      } else {
        originals.push(thumbDS);
      }
    });

    // Second pass: Extract model name from any display set in the group
    aiGroupsMap.forEach((group, key) => {
      let modelName = 'AI Model';

      // Search through all display sets (SR + SC) to find model name
      for (const thumbDS of group.displaySets) {
        const realDS = getRealDisplaySet(thumbDS, servicesManager);
        const aiInfo = extractAIResultData(realDS);

        if (aiInfo?.modelInfo?.name) {
          // Found valid model name - use it and stop searching
          modelName = aiInfo.modelInfo.name;
          break;
        }
      }

      // Set the final label
      group.label = `${modelName}\n${group.dateTime || 'Unknown Date'}`;
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
    // if both same category, newest date first
    return (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0);
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
