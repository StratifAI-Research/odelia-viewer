/**
 * Resolve study-level DICOM tags (StudyDate, StudyDescription, AccessionNumber)
 * for a study.
 *
 * These are not reliably present on OHIF display sets — an Orthanc/DICOMweb
 * study loaded through WADO frequently yields display sets with neither — so the
 * chat panel's study label was falling back to a bare UID tail. That defeats the
 * point of labelling the study at all: a patient commonly has several studies and
 * the date is what distinguishes them.
 *
 * AccessionNumber is resolved for the same reason, as a last resort. Anonymised
 * research data routinely arrives with StudyDate and StudyDescription stripped
 * and the accession left in place as the cohort identifier — the UKA breast MRI
 * set is exactly this, with no (0008,0020) or (0008,1030) on any instance and
 * `UKA_1` in (0008,0050). "UKA_1" is a label a reader can act on;
 * "Study …5106477" is not.
 *
 * The lookup walks three sources, cheapest first, and stops as soon as every tag
 * is known:
 *
 *   1. the display sets themselves,
 *   2. the first instance carried by a display set,
 *   3. `DicomMetadataStore`, the authoritative store.
 *
 * SR and SC series are excluded by the caller (and again in step 3), because a
 * derived AI report carries its own description and would otherwise overwrite the
 * real study's — the same contamination `useStudySeriesSelection` guards against.
 * `orthanc/router/server.py` no longer fabricates those tags, but archives still
 * hold objects written before that fix, so the guard stays.
 */

import { DicomMetadataStore } from '@ohif/core';

export interface StudyTags {
  StudyDate?: string;
  StudyDescription?: string;
  AccessionNumber?: string;
}

/** Treat blank/whitespace tags as absent so they cannot mask a later source. */
function clean(value?: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/** Shape read out of DicomMetadataStore, whose model is typed as `never[]`. */
interface StoredStudy {
  StudyDate?: string;
  StudyDescription?: string;
  AccessionNumber?: string;
  series?: Array<{
    Modality?: string;
    StudyDate?: string;
    StudyDescription?: string;
    AccessionNumber?: string;
    instances?: Array<Record<string, unknown>>;
  }>;
}

export function resolveStudyTags(studyUID: string, imagingDisplaySets: any[] = []): StudyTags {
  let date: string | undefined;
  let description: string | undefined;
  let accession: string | undefined;

  // Date and description are what the label is built from; the accession is only
  // a fallback, so finding it is never on its own a reason to stop looking.
  const enough = () => Boolean(date && description);

  // 1. The display sets themselves.
  for (const ds of imagingDisplaySets) {
    date = date ?? clean(ds?.StudyDate);
    description = description ?? clean(ds?.StudyDescription);
    accession = accession ?? clean(ds?.AccessionNumber);
    if (enough() && accession) {
      return { StudyDate: date, StudyDescription: description, AccessionNumber: accession };
    }
  }

  // 2. The first instance a display set carries.
  for (const ds of imagingDisplaySets) {
    const instance = ds?.instances?.[0] ?? ds?.instance;
    if (!instance) {
      continue;
    }
    date = date ?? clean(instance.StudyDate);
    description = description ?? clean(instance.StudyDescription);
    accession = accession ?? clean(instance.AccessionNumber);
    if (enough() && accession) {
      return { StudyDate: date, StudyDescription: description, AccessionNumber: accession };
    }
  }

  // 3. The metadata store. Guarded: it is an upstream singleton and a miss on an
  // unknown UID must degrade to "no label", never throw into a render.
  let stored: StoredStudy | undefined;
  try {
    stored = DicomMetadataStore?.getStudy?.(studyUID) as StoredStudy | undefined;
  } catch (_) {
    stored = undefined;
  }
  if (!stored) {
    return { StudyDate: date, StudyDescription: description, AccessionNumber: accession };
  }

  // Imaging series only. A derived object written before `orthanc/router/
  // server.py` was fixed carries *fabricated* study-level tags: the heatmap
  // builder set `StudyDescription = "AI Attention Heatmap Visualization"` on its
  // SC, and the report builder set "AI Classification Report" on its SR. Neither
  // describes the study, and archives still hold objects from that era.
  const imagingSeries = (stored.series ?? []).filter(
    s => s?.Modality !== 'SR' && s?.Modality !== 'SC'
  );

  for (const series of imagingSeries) {
    if (enough() && accession) {
      break;
    }
    const instance = series?.instances?.[0];
    date = date ?? clean(instance?.StudyDate) ?? clean(series?.StudyDate);
    description =
      description ?? clean(instance?.StudyDescription) ?? clean(series?.StudyDescription);
    accession = accession ?? clean(instance?.AccessionNumber) ?? clean(series?.AccessionNumber);
  }

  // The store's own study-level tags are an aggregate OHIF fills from whichever
  // instance registered first — which is routinely a derived SR/SC. Trust it only
  // when there is no imaging series to ask instead; otherwise a study with no
  // real description would inherit the AI report's.
  if (imagingSeries.length === 0) {
    date = date ?? clean(stored.StudyDate);
    description = description ?? clean(stored.StudyDescription);
    accession = accession ?? clean(stored.AccessionNumber);
  }

  return { StudyDate: date, StudyDescription: description, AccessionNumber: accession };
}
