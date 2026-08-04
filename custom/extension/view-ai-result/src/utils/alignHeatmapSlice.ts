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
  getCamera?(): { viewPlaneNormal?: number[] };
  element: HTMLDivElement;
};

/**
 * Whether the two viewports show parallel planes.
 *
 * Reimplemented rather than imported: cornerstone's own areViewportsCoplanar is internal to
 * @cornerstonejs/tools (synchronizers/callbacks/) and not re-exported, so there is nothing to
 * import. This mirrors it exactly -- the dot product of the two view-plane normals, with the
 * same 0.9 tolerance, and abs() so anti-parallel planes still count as coplanar.
 *
 * Returns true when either viewport cannot report a camera: undeterminable is not the same as
 * incompatible, and the Frame of Reference check and spatial search still follow.
 */
function areViewportsCoplanar(a: SyncableViewport, b: SyncableViewport): boolean {
  const normalA = a.getCamera?.()?.viewPlaneNormal;
  const normalB = b.getCamera?.()?.viewPlaneNormal;

  if (!normalA || !normalB) {
    return true;
  }

  return Math.abs(vec3.dot(normalA as vec3, normalB as vec3)) > 0.9;
}

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

  // Two DISTINCT checks, which an earlier comment here wrongly conflated.
  //
  // A shared Frame of Reference says the two position vectors are expressed in the same
  // coordinate system; it says nothing about the planes being parallel. Cornerstone's own
  // imageSliceSyncCallback tests those separately, and slice matching is meaningless between
  // non-parallel planes (an axial series against a sagittal one would still share a FoR).
  if (!areViewportsCoplanar(sViewport, tViewport)) {
    console.warn('[HeatmapSync] viewports are not coplanar, skipping sync');
    return null;
  }

  if (sViewport.getFrameOfReferenceUID() !== tViewport.getFrameOfReferenceUID()) {
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

  // Candidates with no imagePlaneModule are skipped rather than destructured: a frame without
  // one (a padded or partially-loaded multi-frame) would otherwise throw inside the reduce and
  // abort the whole sync pass. If none has a position, index stays -1 and nothing moves.
  const closestResult = targetImageIds.reduce(
    (closest, imageId, index) => {
      const imagePositionPatient = metaData.get('imagePlaneModule', imageId)
        ?.imagePositionPatient;

      if (!imagePositionPatient) {
        return closest;
      }

      const distance = vec3.distance(imagePositionPatient, targetImagePositionPatient);

      return distance < closest.distance ? { distance, index } : closest;
    },
    { distance: Infinity, index: -1 }
  );

  // `closestResult.index` is the spatially correct target slice and is used as-is.
  //
  // No index reversal belongs here, PROVIDED the source position came from
  // getCurrentImageId() (see currentImageIdOf). The reversal this file used to apply existed
  // only to cancel the error of reading the source position out of the flat imageIds array;
  // with the position read correctly, the mirrored index falls out of the spatial search by
  // itself. Verified: MR slice 8 (z 29.36) resolves to heatmap frame 22 (z 29.36).
  //
  // Note cornerstone's own callback reverses for a volume TARGET using
  // `targetImageIds.length - index - 1`. That is right for a plain volume but wrong for a
  // dynamic one, where the array holds 155 imageIds over 31 slices -- which is why a volume
  // target is declined above rather than handled with upstream's formula.
  if (closestResult.index === -1 || tViewport.getCurrentImageIdIndex() === closestResult.index) {
    return null;
  }

  await utilities.jumpToSlice(tViewport.element, { imageIndex: closestResult.index });

  return closestResult.index;
}
