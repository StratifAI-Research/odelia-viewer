/**
 * Small AI-selection adapter for the study browser panel.
 *
 * Isolates how the panel talks to `aiResultsService` for selection concerns:
 * recognizing AI-result thumbnails and resolving the initially-selected SR for
 * a set of studies. Pure and service-driven, so it can be tested without the
 * React panel.
 */

/** SR (structured report) and SC (secondary capture / heatmap) are AI results. */
export function isAIResultModality(modality?: string): boolean {
  return modality === 'SR' || modality === 'SC';
}

/**
 * Resolve the SR display-set UID that is currently selected across the given
 * studies, or `null` if none. Mirrors the panel's mount-time initial-selection
 * logic: for each study, if a result is selected, read the selected UID from
 * the metadata helper.
 */
export function resolveInitialSelectedSRUID(
  studyInstanceUIDs: string[] | undefined,
  aiResultsService: any,
  servicesManager: AppTypes.ServicesManager
): string | null {
  if (!studyInstanceUIDs?.length || !aiResultsService) {
    return null;
  }
  for (const sid of studyInstanceUIDs) {
    const initial = aiResultsService.getSelectedAIResult?.(sid, servicesManager);
    // `getSelectedAIResult` returns AIResult | null without a UID, so rely on
    // the metadata helper to find which display set is flagged selected.
    if (!initial) {
      continue;
    }
    const metaList = aiResultsService.getAIResultMetadata?.(sid, servicesManager);
    const selectedMeta = metaList?.find((m: any) => m.isSelected);
    if (selectedMeta) {
      return selectedMeta.displaySetInstanceUID;
    }
  }
  return null;
}
