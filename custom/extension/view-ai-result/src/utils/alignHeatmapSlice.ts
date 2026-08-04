import { metaData, utilities } from '@cornerstonejs/core';
import { vec3, mat4 } from 'gl-matrix';

/**
 * The slice of a cornerstone viewport this needs. Structural rather than
 * StackViewport | VolumeViewport so both kinds, and test doubles, satisfy it -- the callback
 * this was extracted from already handled its viewports as `any`.
 */
export type SyncableViewport = {
  getCurrentImageIdIndex(): number;
  getImageIds(): string[];
  getFrameOfReferenceUID(): string;
  getCurrentImageId?(): string | undefined;
  getNumberOfSlices?(): number;
  getCamera?(): { viewPlaneNormal?: number[] };
  element: HTMLDivElement;
};

/**
 * Why an alignment did or did not happen. Distinct outcomes on purpose: callers have to tell
 * "already in the right place" (success) from "cannot be aligned" (do not sync these at all)
 * from "tried and failed" (undo). Collapsing them to null/throw is what let a failed alignment
 * be reported as success.
 */
export type AlignmentOutcome =
  | { status: 'aligned'; imageIndex: number }
  | { status: 'alreadyAligned' }
  | { status: 'unsupported'; reason: string }
  | { status: 'failed'; reason: string };

/** An imagePositionPatient safe to hand to vec3: present, length 3, all finite. */
const isUsablePosition = (value: unknown): value is number[] =>
  Array.isArray(value) && value.length === 3 && value.every(n => Number.isFinite(n));

const positionOf = (imageId: string | undefined): number[] | undefined => {
  if (!imageId) {
    return undefined;
  }
  const position = metaData.get('imagePlaneModule', imageId)?.imagePositionPatient;

  return isUsablePosition(position) ? position : undefined;
};

/**
 * Whether the two viewports show parallel planes.
 *
 * Reimplemented rather than imported: cornerstone's own areViewportsCoplanar is internal to
 * @cornerstonejs/tools (synchronizers/callbacks/) and not re-exported. This mirrors it -- the
 * dot product of the two view-plane normals, 0.9 tolerance, abs() so anti-parallel planes
 * still count as coplanar.
 *
 * A viewport that cannot report a normal is treated as INCOMPATIBLE, not compatible. An
 * earlier version defaulted to compatible on the reasoning that "undeterminable is not
 * incompatible"; that is wrong for a safety check -- it lets exactly the mismatch this exists
 * to catch through whenever the camera is unavailable. Cornerstone's helper likewise requires
 * both cameras.
 */
function areViewportsCoplanar(a: SyncableViewport, b: SyncableViewport): boolean {
  const normalA = a.getCamera?.()?.viewPlaneNormal;
  const normalB = b.getCamera?.()?.viewPlaneNormal;

  if (!isUsablePosition(normalA) || !isUsablePosition(normalB)) {
    return false;
  }

  return Math.abs(vec3.dot(normalA as vec3, normalB as vec3)) > 0.9;
}

/**
 * Whether a viewport navigates by volume slice rather than by image index.
 *
 * `getNumberOfSlices() !== getImageIds().length` was NOT a sound test: a non-dynamic volume
 * reports equal counts, so it was classified as a stack and handed a flat imageIds index,
 * which for a volume is the mirrored slice. Cornerstone identifies volume targets by
 * `instanceof VolumeViewport`, `viewportIsInVolumeMode()`, and a render-mode fallback; the
 * public utility covers the cases reachable here without importing the class.
 */
function isVolumeNavigated(viewport: SyncableViewport): boolean {
  const inVolumeMode = (utilities as any).viewportIsInVolumeMode;

  if (typeof inVolumeMode === 'function') {
    try {
      return !!inVolumeMode(viewport);
    } catch {
      // Falls through to the weaker test below.
    }
  }

  // Fallback only for when that utility is unavailable. Deliberately NOT "has
  // getNumberOfSlices": a real StackViewport implements it too (measured: a 31-image stack
  // reports 31 slices), so that would classify every stack as a volume and refuse all syncing.
  // Unequal counts still catch a DYNAMIC volume; a plain volume is missed, which is why the
  // capability check above is the primary path.
  const slices = viewport.getNumberOfSlices?.();

  return slices !== undefined && slices !== viewport.getImageIds().length;
}

/**
 * Move `tViewport` to the slice at the same patient position as `sViewport`'s current slice.
 *
 * Extracted from the synchronizer's event callback so the same logic can be applied once, on
 * demand -- adding viewports to a sync group only arms it for the NEXT slice-change event,
 * which left the heatmap on whatever slice it opened at until the reader scrolled.
 */
export default async function alignHeatmapSlice(
  sViewport: SyncableViewport,
  tViewport: SyncableViewport,
  options: {
    sourceViewportId: string;
    targetViewportId: string;
    useInitialPosition?: boolean;
  }
): Promise<AlignmentOutcome> {
  // No fallback to getImageIds()[getCurrentImageIdIndex()]. That expression is the mirrored
  // source position this whole fix removed: on a VolumeViewport the index is a SLICE index and
  // the slice axis runs opposite to the flat array, so slice 0 reads as z=-43.24 when the
  // viewport is actually showing z=+55.75. Keeping it as a "safe" fallback would silently
  // reintroduce the bug on any viewport lacking getCurrentImageId.
  if (typeof sViewport.getCurrentImageId !== 'function') {
    return { status: 'unsupported', reason: 'source viewport cannot report its current image' };
  }

  const sourceImageId = sViewport.getCurrentImageId();
  const sourceImagePositionPatient = positionOf(sourceImageId);

  if (!sourceImagePositionPatient) {
    return { status: 'unsupported', reason: 'source slice has no usable imagePositionPatient' };
  }

  // A volume TARGET needs a slice index, while the spatial search below yields an index into
  // the target's flat imageIds. For a dynamic volume those are neither the same range (155 vs
  // 31) nor the same direction, and cornerstone's own `targetImageIds.length - index - 1`
  // formula is only right for the non-dynamic case. Refuse every volume target until this
  // navigates by world position instead.
  if (isVolumeNavigated(tViewport)) {
    return { status: 'unsupported', reason: 'target navigates by volume slice' };
  }

  // Two DISTINCT checks, which an earlier comment here wrongly conflated. A shared Frame of
  // Reference says the position vectors use the same coordinate system; it says nothing about
  // the planes being parallel (an axial and a sagittal series can share one). Cornerstone
  // tests them separately.
  if (!areViewportsCoplanar(sViewport, tViewport)) {
    return { status: 'unsupported', reason: 'viewports are not coplanar' };
  }

  const sourceFoR = sViewport.getFrameOfReferenceUID();
  const targetFoR = tViewport.getFrameOfReferenceUID();

  // Non-empty, not merely equal: two MISSING FoR UIDs compare equal, which would otherwise be
  // read as "same frame of reference" and licence the identity registration below.
  if (!sourceFoR || !targetFoR || sourceFoR !== targetFoR) {
    return { status: 'unsupported', reason: 'viewports do not share a Frame of Reference' };
  }

  let registrationMatrixMat4 = utilities.spatialRegistrationMetadataProvider.get(
    'spatialRegistrationModule',
    options.targetViewportId,
    options.sourceViewportId
  );

  if (!registrationMatrixMat4) {
    if (options.useInitialPosition !== false) {
      registrationMatrixMat4 = mat4.identity(mat4.create());
    } else {
      // Cast for the same reason SyncableViewport exists: the helper's signature names the
      // concrete viewport classes, while only these few members are actually touched.
      utilities.calculateViewportsSpatialRegistration(sViewport as never, tViewport as never);
      registrationMatrixMat4 = utilities.spatialRegistrationMetadataProvider.get(
        'spatialRegistrationModule',
        options.targetViewportId,
        options.sourceViewportId
      );
    }

    if (!registrationMatrixMat4) {
      return { status: 'failed', reason: 'could not establish a spatial registration' };
    }
  }

  const targetImagePositionPatient = vec3.transformMat4(
    vec3.create(),
    sourceImagePositionPatient as vec3,
    registrationMatrixMat4
  );

  const targetImageIds = tViewport.getImageIds();

  // Candidates without a usable position are skipped rather than destructured: a frame with no
  // imagePlaneModule, or a malformed one, would otherwise throw inside the reduce (or feed NaN
  // to vec3.distance) and abort the whole pass.
  const closest = targetImageIds.reduce(
    (best, imageId, index) => {
      const imagePositionPatient = positionOf(imageId);

      if (!imagePositionPatient) {
        return best;
      }

      const distance = vec3.distance(imagePositionPatient as vec3, targetImagePositionPatient);

      return distance < best.distance ? { distance, index } : best;
    },
    { distance: Infinity, index: -1 }
  );

  if (closest.index === -1) {
    return { status: 'unsupported', reason: 'no target slice has a usable imagePositionPatient' };
  }

  // Nearest-neighbour always returns SOMETHING, so distance has to be checked too: two series
  // that share a Frame of Reference but do not overlap would otherwise silently snap to an
  // endpoint and look aligned. Tolerance is one slice gap, derived from the target's own
  // spacing, falling back to a permissive value when only one slice has a position.
  const spacing = estimateSliceSpacing(targetImageIds);

  if (spacing !== undefined && closest.distance > spacing) {
    return {
      status: 'unsupported',
      reason: `nearest target slice is ${closest.distance.toFixed(2)}mm away (spacing ${spacing.toFixed(2)}mm)`,
    };
  }

  // `closest.index` is used as-is. No index reversal belongs here PROVIDED the source position
  // came from getCurrentImageId(): the reversal this file used to apply existed only to cancel
  // the error of reading the source out of the flat array. Verified: MR slice 8 (z 29.36)
  // resolves to heatmap frame 22 (z 29.36).
  if (tViewport.getCurrentImageIdIndex() === closest.index) {
    return { status: 'alreadyAligned' };
  }

  await utilities.jumpToSlice(tViewport.element, { imageIndex: closest.index });

  return { status: 'aligned', imageIndex: closest.index };
}

/** Median gap between consecutive target slice positions, or undefined if not derivable. */
function estimateSliceSpacing(imageIds: string[]): number | undefined {
  const positions = imageIds.map(positionOf).filter(Boolean) as number[][];

  if (positions.length < 2) {
    return undefined;
  }

  const gaps: number[] = [];
  for (let i = 1; i < positions.length; i++) {
    const gap = vec3.distance(positions[i - 1] as vec3, positions[i] as vec3);
    if (gap > 0) {
      gaps.push(gap);
    }
  }

  if (!gaps.length) {
    return undefined;
  }

  gaps.sort((a, b) => a - b);

  return gaps[Math.floor(gaps.length / 2)];
}
