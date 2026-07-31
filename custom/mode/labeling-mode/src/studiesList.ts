import { DicomMetadataStore } from '@ohif/core';

type StudyMetadata = AppTypes.StudyMetadata.StudyMetadata;

/**
 * Compare function for sorting
 *
 * @param a - some simple value (string, number, timestamp)
 * @param b - some simple value
 * @param defaultCompare - default return value as a fallback when a===b
 * @returns - compare a and b, returning 1 if a<b -1 if a>b and defaultCompare otherwise
 */
const compare = (a, b, defaultCompare = 0): number => {
  if (a === b) {
    return defaultCompare;
  }
  if (a < b) {
    return 1;
  }
  return -1;
};

/**
 * The studies from display sets gets the studies in study date
 * order or in study instance UID order - not very useful, but
 * if not specifically specified then at least making it consistent is useful.
 */
const getStudiesFromDisplaySets = (displaySets: any[]): StudyMetadata[] => {
  const studyMap = {};

  const ret = displaySets.reduce((prev, curr) => {
    const { StudyInstanceUID } = curr;
    if (!studyMap[StudyInstanceUID]) {
      const study = DicomMetadataStore.getStudy(StudyInstanceUID);
      studyMap[StudyInstanceUID] = study;
      prev.push(study);
    }
    return prev;
  }, []);
  // Return the sorted studies, first on study date and second on study instance UID
  ret.sort((a, b) => {
    return compare(a.StudyDate, b.StudyDate, compare(a.StudyInstanceUID, b.StudyInstanceUID));
  });
  return ret;
};

/**
 * The studies retrieve from the Uids is faster and gets the studies
 * in the original order, as specified.
 */
// Returns undefined (not []) when there are no UIDs, so the `||` fallback in
// getStudies falls through to getStudiesFromDisplaySets — an empty array would
// be truthy and suppress the fallback.
const getStudiesFromUIDs = (studyUids?: string[]): StudyMetadata[] | undefined => {
  if (!studyUids?.length) {
    return;
  }
  // `getStudy` is untyped upstream (it infers `undefined` from an empty model
  // literal); a UID with no stored study genuinely yields a hole, which the
  // callers already tolerate.
  return studyUids.map(uid => DicomMetadataStore.getStudy(uid)) as unknown as StudyMetadata[];
};

/** Gets the array of studies */
const getStudies = (studyUids: string[] | undefined, displaySets: any[]): StudyMetadata[] => {
  return getStudiesFromUIDs(studyUids) || getStudiesFromDisplaySets(displaySets);
};

export default getStudies;

export { getStudies, getStudiesFromUIDs, getStudiesFromDisplaySets, compare };
