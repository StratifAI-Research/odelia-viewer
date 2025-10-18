import { getStaticDate } from './dateCache';
import { extractAIResultData } from './extractAIResultData';
import { formatDicomDateTime } from './dicomDateTime';

// Re-use the real-display-set cache from the flat util to avoid re-computing.
const displaySetCache = new Map<string, any>();

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
  // Helper – is this thumbnail an AI result?
  const isAIResult = (ds: any) => {
    const modality = ds.Modality || ds.modality;
    return modality === 'SR' || modality === 'SC';
  };

  // Helper – resolve displaySet from service (expensive) but cache the result.
  const getRealDisplaySet = (thumbDS: any) => {
    const key = thumbDS.displaySetInstanceUID;
    if (displaySetCache.has(key)) {
      return displaySetCache.get(key);
    }

    const dss = servicesManager?.services?.displaySetService;
    if (!dss) {
      displaySetCache.set(key, thumbDS);
      return thumbDS;
    }

    let real;
    try {
      real = dss.getDisplaySetByUID(thumbDS.displaySetInstanceUID) || thumbDS;
    } catch {
      real = thumbDS;
    }
    displaySetCache.set(key, real);
    return real;
  };

  // Helper – date/time → "YYYY-MM-DD HH:mm:ss" respecting timezone offset when provided
  const formatDateTime = (date?: string, time?: string, offset?: string | null) => {
    if (!date) return null;
    return formatDicomDateTime(date, time, offset);
  };

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

    studyDisplaySets.forEach(thumbDS => {
      if (isAIResult(thumbDS)) {
        const realDS = getRealDisplaySet(thumbDS);
        const aiInfo = extractAIResultData(realDS);
        const modelName = aiInfo?.modelInfo?.name || 'AI';
        const date = realDS?.instance?.InstanceCreationDate;
        const time = realDS?.instance?.InstanceCreationTime;
        const tz = realDS?.instance?.TimezoneOffsetFromUTC || realDS?.instance?.TimezoneOffset || null;
        const dateTime = formatDateTime(date, time, tz);
        const key = dateTime || `UNKNOWN_${modelName}`;
        if (!aiGroupsMap.has(key)) {
          aiGroupsMap.set(key, {
            key,
            label: dateTime ? `${modelName} – ${dateTime}` : `${modelName} – Unknown`,
            displaySets: [],
            sortKey: dateTime || '00000000',
          });
        }
        aiGroupsMap.get(key).displaySets.push(thumbDS);
      } else {
        originals.push(thumbDS);
      }
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
  displaySetCache.clear();
}
