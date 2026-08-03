import { metaData, utilities } from '@cornerstonejs/core';
import { vec3, mat4 } from 'gl-matrix';

/**
 * The slice of a cornerstone viewport this needs. Structural rather than
 * StackViewport | VolumeViewport so both kinds, and test doubles, satisfy it -- the callback
 * this was extracted from already handled its viewports as `any`.
 */
type SyncableViewport = {
  getCurrentImageIdIndex(): number;
  getImageIds(): string[];
  getFrameOfReferenceUID(): string;
  getCurrentImageId?(): string | undefined;
  getNumberOfSlices?(): number;
  element: HTMLDivElement;
};

/**
 * The imageId of the slice a viewport is actually showing.
 *
 * MUST NOT be `getImageIds()[getCurrentImageIdIndex()]`. On a VolumeViewport that index is a
 * SLICE index, and the slice axis runs opposite to the flat imageIds array: measured on the
 * ODELIA dynamic MR (155 imageIds = 31 slices x 5 temporal positions), slice 0 is at
 * z = +55.75 while imageIds[0] is at z = -43.24, and the two agree only at the midpoint,
 * slice 15. Indexing the array therefore yields the MIRRORED position, which is what made
 * the heatmap track the wrong way; the old `length - index - 1` reversal existed to cancel
 * that error rather than to fix it. getCurrentImageId() asks the viewport what it is showing
 * and is correct for both viewport types.
 */
const currentImageIdOf = (viewport: SyncableViewport): string | undefined =>
  viewport.getCurrentImageId?.() ?? viewport.getImageIds()[viewport.getCurrentImageIdIndex()];

/**
 * Move `tViewport` to the slice that sits at the same patient position as `sViewport`'s
 * current slice.
 *
 * Extracted from the synchronizer's event callback so the same logic can be applied once,
 * on demand -- adding viewports to a sync group only arms it for the NEXT slice-change
 * event, which left the heatmap sitting on whatever slice it opened at until the reader
 * scrolled. toggleHeatmapImageSliceSync calls this to align immediately on enable.
 *
 * Returns the index it moved to, or null when it could not (or did not need to) move, so
 * callers can tell "aligned" from "skipped".
 */
export default async function alignHeatmapSlice(
  sViewport: SyncableViewport,
  tViewport: SyncableViewport,
  options: {
    sourceViewportId: string;
    targetViewportId: string;
    useInitialPosition?: boolean;
  }
): Promise<number | null> {
  const sourceImageId = currentImageIdOf(sViewport);

  if (!sourceImageId) {
    return null;
  }

  const imagePlaneModule = metaData.get('imagePlaneModule', sourceImageId);
  const sourceImagePositionPatient = imagePlaneModule?.imagePositionPatient;

  if (!sourceImagePositionPatient) {
    return null;
  }

  // A volume TARGET is not supported: the spatial search below returns an index into the
  // target's flat imageIds, while jumpToSlice on a VolumeViewport expects a SLICE index, and
  // for a dynamic volume those are neither the same range (155 vs 31) nor the same direction.
  // Passing one for the other jumps to an unrelated slice or out of range, so decline rather
  // than move the reader somewhere wrong. The direction this feature exists for -- a volume
  // source driving the heatmap stack -- is unaffected.
  if (typeof tViewport.getNumberOfSlices === 'function') {
    const slices = tViewport.getNumberOfSlices();
    if (slices != null && slices !== tViewport.getImageIds().length) {
      console.warn(
        '[HeatmapSync] target is a volume whose slice index differs from its imageIds; ' +
          'skipping rather than jumping to the wrong slice'
      );
      return null;
    }
  }

  const targetImageIds = tViewport.getImageIds();

  // Coplanar check: without a shared Frame of Reference the positions are not comparable.
  const sourceFrameOfReferenceUID = sViewport.getFrameOfReferenceUID();
  const targetFrameOfReferenceUID = tViewport.getFrameOfReferenceUID();

  if (sourceFrameOfReferenceUID !== targetFrameOfReferenceUID) {
    console.warn('[HeatmapSync] Different Frame of Reference, skipping sync');
    return null;
  }

  let registrationMatrixMat4 = utilities.spatialRegistrationMetadataProvider.get(
    'spatialRegistrationModule',
    options?.targetViewportId,
    options?.sourceViewportId
  );

  if (!registrationMatrixMat4) {
    if (options?.useInitialPosition !== false) {
      registrationMatrixMat4 = mat4.identity(mat4.create());
    } else {
      // Cast for the same reason SyncableViewport exists: the helper's signature names the
      // concrete viewport classes, while only these few members are actually touched.
      utilities.calculateViewportsSpatialRegistration(
        sViewport as never,
        tViewport as never
      );
      registrationMatrixMat4 = utilities.spatialRegistrationMetadataProvider.get(
        'spatialRegistrationModule',
        options?.targetViewportId,
        options?.sourceViewportId
      );
    }

    if (!registrationMatrixMat4) {
      console.error('[HeatmapSync] Could not calculate registration matrix');
      return null;
    }
  }

  const targetImagePositionPatient = vec3.transformMat4(
    vec3.create(),
    sourceImagePositionPatient,
    registrationMatrixMat4
  );

  const closestResult = targetImageIds.reduce(
    (closest, imageId, index) => {
      const { imagePositionPatient } = metaData.get('imagePlaneModule', imageId);
      const distance = vec3.distance(imagePositionPatient, targetImagePositionPatient);

      return distance < closest.distance ? { distance, index } : closest;
    },
    { distance: Infinity, index: -1 }
  );

  // `closestResult.index` is already the spatially correct slice: it is whichever target
  // image sits nearest the registered source position. Nothing further may be applied to
  // it.
  //
  // This used to reverse the index for a volume source and a stack target
  // (`targetImageIds.length - index - 1`), on the premise that "volume displays in reverse
  // of anatomical order". That premise is false for these series, and the reversal was the
  // cause of the heatmap tracking the wrong way: measured against the ODELIA study, the MR
  // volume's imageIds and the heatmap stack's are BOTH ascending in z (both run
  // -43.24 -> 55.75), and the volume's own index maps monotonically onto that order.
  // Reversing therefore turned a correct match into a mirrored one -- MR index 12 (z
  // -3.64) drove the heatmap to 18 (z 16.16) instead of 12, and index 25 to 5 instead of
  // 25, both exactly 31 - index - 1. A spatial match and an index reversal are mutually
  // exclusive; keep the spatial one.
  if (closestResult.index === -1 || tViewport.getCurrentImageIdIndex() === closestResult.index) {
    return null;
  }

  await utilities.jumpToSlice(tViewport.element, { imageIndex: closestResult.index });

  return closestResult.index;
}
