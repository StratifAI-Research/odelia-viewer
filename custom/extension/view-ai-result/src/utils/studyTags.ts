/**
 * Resolve study-level DICOM tags (StudyDate, StudyDescription) for a study.
 *
 * These are not reliably present on OHIF display sets — an Orthanc/DICOMweb
 * study loaded through WADO frequently yields display sets with neither — so the
 * chat panel's study label was falling back to a bare UID tail. That defeats the
 * point of labelling the study at all: a patient commonly has several studies and
 * the date is what distinguishes them.
 *
 * The lookup walks three sources, cheapest first, and stops as soon as both tags
 * are known:
 *
 *   1. the display sets themselves,
 *   2. the first instance carried by a display set,
 *   3. `DicomMetadataStore`, the authoritative store.
 *
 * SR and SC series are excluded by the caller (and again in step 3), because a
 * derived AI report carries its own description and would otherwise overwrite the
 * real study's — the same contamination `useStudySeriesSelection` guards against.
 */

import { DicomMetadataStore } from '@ohif/core';

export interface StudyTags {
  StudyDate?: string;
  StudyDescription?: string;
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
  series?: Array<{
    Modality?: string;
    StudyDate?: string;
    StudyDescription?: string;
    instances?: Array<Record<string, unknown>>;
  }>;
}

export function resolveStudyTags(studyUID: string, imagingDisplaySets: any[] = []): StudyTags {
  let date: string | undefined;
  let description: string | undefined;

  // 1. The display sets themselves.
  for (const ds of imagingDisplaySets) {
    date = date ?? clean(ds?.StudyDate);
    description = description ?? clean(ds?.StudyDescription);
    if (date && description) {
      return { StudyDate: date, StudyDescription: description };
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
    if (date && description) {
      return { StudyDate: date, StudyDescription: description };
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
    return { StudyDate: date, StudyDescription: description };
  }

  // Imaging series only. A derived object carries *fabricated* study-level tags:
  // the heatmap router sets `StudyDescription = "AI Attention Heatmap
  // Visualization"` on the SC it writes, and the report writer sets "AI
  // Classification Report" on its SR. Neither describes the study.
  const imagingSeries = (stored.series ?? []).filter(
    s => s?.Modality !== 'SR' && s?.Modality !== 'SC'
  );

  for (const series of imagingSeries) {
    if (date && description) {
      break;
    }
    const instance = series?.instances?.[0];
    date = date ?? clean(instance?.StudyDate) ?? clean(series?.StudyDate);
    description =
      description ?? clean(instance?.StudyDescription) ?? clean(series?.StudyDescription);
  }

  // The store's own study-level tags are an aggregate OHIF fills from whichever
  // instance registered first — which is routinely a derived SR/SC. Trust it only
  // when there is no imaging series to ask instead; otherwise a study with no
  // real description would inherit the AI report's.
  if (imagingSeries.length === 0) {
    date = date ?? clean(stored.StudyDate);
    description = description ?? clean(stored.StudyDescription);
  }

  return { StudyDate: date, StudyDescription: description };
}
