import { extractAIResultData } from '../../utils/extractAIResultData';
import { getStaticDate } from '../../utils/dateCache';

/**
 * Pure display-set → thumbnail-props mapping for the study browser panel.
 * Kept separate from `PanelStudyBrowserTracking` so the AI decoration,
 * grouping, and navigation lookups are independently testable, free of the
 * panel's subscriptions, timers, and viewport state.
 *
 * Note on caching: the expensive *static* props (AI-decorated description,
 * static date, component type) are memoized per display set in
 * `thumbnailPropsCache`. Cached values are never mutated in place — each call
 * returns a fresh object combining the cached static props with
 * freshly-computed dynamic props (loading progress, image src,
 * tracked/selected state). Mutating cached objects would defeat React's
 * referential change detection.
 */

export const thumbnailNoImageModalities = [
  'SR',
  'SEG',
  'SM',
  'RTSTRUCT',
  'RTPLAN',
  'RTDOSE',
  'DOC',
  'OT',
  'PMAP',
];

export function getComponentType(ds: any): 'thumbnailNoImage' | 'thumbnailTracked' {
  if (thumbnailNoImageModalities.includes(ds.Modality) || ds?.unsupported) {
    return 'thumbnailNoImage';
  }
  return 'thumbnailTracked';
}

export function getImageIdForThumbnail(displaySet: any, imageIds: any): any {
  let imageId;
  if (displaySet.isDynamicVolume) {
    const timePoints = displaySet.dynamicVolumeInfo.timePoints;
    const middleIndex = Math.floor(timePoints.length / 2);
    const middleTimePointImageIds = timePoints[middleIndex];
    imageId = middleTimePointImageIds[Math.floor(middleTimePointImageIds.length / 2)];
  } else {
    imageId = imageIds[Math.floor(imageIds.length / 2)];
  }
  return imageId;
}

/**
 * Maps from the DataSource's format to a naturalized object
 */
export function mapDataSourceStudies(studies: any[]): any[] {
  return studies.map(study => {
    return {
      AccessionNumber: study.accession,
      StudyDate: study.date,
      StudyDescription: study.description,
      NumInstances: study.instances,
      ModalitiesInStudy: study.modalities,
      PatientID: study.mrn,
      PatientName: study.patientName,
      StudyInstanceUID: study.studyInstanceUid,
      StudyTime: study.time,
    };
  });
}

interface StaticThumbnailProps {
  displaySetInstanceUID: string;
  description: string;
  seriesNumber: number;
  modality: string;
  seriesDate: any;
  numInstances: number;
  countIcon: string;
  messages: null;
  StudyInstanceUID: string;
  componentType: string;
  dragData: { type: string; displaySetInstanceUID: string };
  isHydratedForDerivedDisplaySet: boolean;
}

interface CachedThumbnail {
  staticProps: StaticThumbnailProps;
  /** Whether this display set is an AI result (drives the AI CSS class). */
  isAIResult: boolean;
}

/** AI-decorated description for a display set (the expensive, static part). */
function buildDescription(ds: any, aiResultData: any): string {
  let enhancedDescription = ds.SeriesDescription || '';

  if (aiResultData && aiResultData.modelInfo) {
    const lines = [`🤖 ${aiResultData.modelInfo.name}`];
    if (aiResultData.isClassification && aiResultData.classifications.length > 0) {
      aiResultData.classifications.forEach((classification: any) => {
        const side = classification.side;
        if (classification.errorMessage) {
          lines.push(`${side}: ${classification.errorMessage}`);
        } else if (classification.result !== null) {
          const result = classification.result;
          const confidence =
            classification.confidence != null ? ` ${classification.confidence.toFixed(1)}%` : '';
          lines.push(`${side}: ${result}${confidence}`);
        }
      });
    } else {
      lines.push('No classification results');
    }
    enhancedDescription = lines.join('\n');
  } else if (ds.Modality === 'SR') {
    enhancedDescription = `🤖 AI Result\n${ds.SeriesDescription || 'Structured Report'}`;
  } else if (ds.Modality === 'SC') {
    enhancedDescription = `🤖 Heatmap`;
  }

  if (!enhancedDescription || enhancedDescription.trim() === '') {
    enhancedDescription = 'Unknown Series';
  }
  return enhancedDescription;
}

function computeStaticThumbnail(ds: any, componentType: string): CachedThumbnail {
  const aiResultData = extractAIResultData(ds);
  const staticProps: StaticThumbnailProps = {
    displaySetInstanceUID: ds.displaySetInstanceUID,
    description: buildDescription(ds, aiResultData),
    seriesNumber: ds.SeriesNumber,
    modality: ds.Modality,
    seriesDate: getStaticDate(ds), // static date preserved to prevent constant refreshing
    numInstances: ds.numImageFrames,
    countIcon: ds.countIcon,
    messages: null,
    StudyInstanceUID: ds.StudyInstanceUID,
    componentType,
    dragData: {
      type: 'displayset',
      displaySetInstanceUID: ds.displaySetInstanceUID,
    },
    isHydratedForDerivedDisplaySet: ds.isHydrated,
  };
  const isAIResult = !!(aiResultData || ds.Modality === 'SR' || ds.Modality === 'SC');
  return { staticProps, isAIResult };
}

export interface MapDisplaySetsArgs {
  displaySets: any[];
  displaySetLoadingState: Record<string, number> | undefined;
  thumbnailImageSrcMap: Record<string, string>;
  trackedSeriesInstanceUIDs: string[];
  selectedSRUID: string | null;
  thumbnailPropsCache?: Map<string, CachedThumbnail>;
}

export function mapDisplaySets({
  displaySets,
  displaySetLoadingState,
  thumbnailImageSrcMap,
  trackedSeriesInstanceUIDs,
  selectedSRUID,
  thumbnailPropsCache = new Map<string, CachedThumbnail>(),
}: MapDisplaySetsArgs): any[] {
  const thumbnailDisplaySets: any[] = [];
  const thumbnailNoImageDisplaySets: any[] = [];

  displaySets
    .filter(ds => !ds.excludeFromThumbnailBrowser)
    .forEach(ds => {
      const { thumbnailSrc, displaySetInstanceUID } = ds;
      const componentType = getComponentType(ds);
      const array =
        componentType === 'thumbnailTracked' ? thumbnailDisplaySets : thumbnailNoImageDisplaySets;

      const loadingProgress = displaySetLoadingState?.[displaySetInstanceUID];
      const isSelectedSR = ds.Modality === 'SR' && displaySetInstanceUID === selectedSRUID;

      // Static props are keyed by uid + the static date so a date change (rare)
      // recomputes the cache entry.
      const cacheKey = `${displaySetInstanceUID}-${ds.SeriesDate || ds.StudyDate || ds.instance?.InstanceCreationDate}`;
      let cached = thumbnailPropsCache.get(cacheKey);
      if (!cached) {
        cached = computeStaticThumbnail(ds, componentType);
        thumbnailPropsCache.set(cacheKey, cached);
      }

      const className = cached.isAIResult
        ? `ai-result-thumbnail${isSelectedSR ? ' selected' : ''}`
        : '';

      // Fresh object every call: never mutate the cached static props.
      array.push({
        ...cached.staticProps,
        loadingProgress,
        imageSrc: thumbnailSrc || thumbnailImageSrcMap[displaySetInstanceUID],
        isTracked: trackedSeriesInstanceUIDs.includes(ds.SeriesInstanceUID),
        className,
      });
    });

  return [...thumbnailDisplaySets, ...thumbnailNoImageDisplaySets];
}

export function findTabAndStudyOfDisplaySet(
  displaySetInstanceUID: string,
  tabs: any[]
): { tabName: string; StudyInstanceUID: string } | undefined {
  for (let t = 0; t < tabs.length; t++) {
    const { studies } = tabs[t];

    for (let s = 0; s < studies.length; s++) {
      const study = studies[s];

      // Check in originals array (for nested structure)
      if (study.originals) {
        for (let d = 0; d < study.originals.length; d++) {
          if (study.originals[d].displaySetInstanceUID === displaySetInstanceUID) {
            return { tabName: tabs[t].name, StudyInstanceUID: study.studyInstanceUid };
          }
        }
      }

      // Check in aiGroups array (for nested structure)
      if (study.aiGroups) {
        for (let g = 0; g < study.aiGroups.length; g++) {
          const group = study.aiGroups[g];
          if (group.displaySets) {
            for (let d = 0; d < group.displaySets.length; d++) {
              if (group.displaySets[d].displaySetInstanceUID === displaySetInstanceUID) {
                return { tabName: tabs[t].name, StudyInstanceUID: study.studyInstanceUid };
              }
            }
          }
        }
      }

      // Fallback for flat structure (old tab mode)
      if (study.displaySets) {
        for (let d = 0; d < study.displaySets.length; d++) {
          if (study.displaySets[d].displaySetInstanceUID === displaySetInstanceUID) {
            return { tabName: tabs[t].name, StudyInstanceUID: study.studyInstanceUid };
          }
        }
      }
    }
  }

  return undefined;
}
