import { metaData, utilities, VolumeViewport } from '@cornerstonejs/core';
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
  // Every signal here is POSITIVE-ONLY and they are OR-ed. An earlier version returned
  // viewportIsInVolumeMode()'s answer directly, which silently misclassified real
  // VolumeViewports: that helper reads `getCurrentMode()`, a method these viewports do not
  // implement, so it answers false and short-circuited the rest. The MR then took the stack
  // path and a heatmap at z=-23.44 drove it to slice 6 instead of 24.
  if (viewport instanceof VolumeViewport) {
    return true;
  }

  const inVolumeMode = (utilities as any).viewportIsInVolumeMode;

  if (typeof inVolumeMode === 'function') {
    try {
      if (inVolumeMode(viewport)) {
        return true;
      }
    } catch {
      // Not decisive; fall through.
    }
  }

  // Deliberately NOT "has getNumberOfSlices": a real StackViewport implements it too (measured:
  // a 31-image stack reports 31 slices), so that alone would classify every stack as a volume
  // and refuse all syncing. Unequal counts catch a DYNAMIC volume.
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

  const targetIsVolume = isVolumeNavigated(tViewport);

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

  // For a STACK target `closest.index` is the answer as-is. No index reversal belongs here
  // PROVIDED the source position came from getCurrentImageId(): the reversal this file used to
  // apply existed only to cancel the error of reading the source out of the flat array.
  // Verified: MR slice 8 (z 29.36) resolves to heatmap frame 22 (z 29.36).
  //
  // For a VOLUME target it is NOT the answer: jumpToSlice wants a slice index, and the flat
  // imageIds array is neither the same length (155 vs 31 slices for the dynamic MR) nor the
  // same direction. Cornerstone's `targetImageIds.length - index - 1` is right only when those
  // lengths happen to match, so resolve the slice index from world position instead.
  const imageIndex = targetIsVolume
    ? volumeSliceIndexFor(tViewport, targetImagePositionPatient)
    : closest.index;

  if (imageIndex === undefined) {
    return { status: 'unsupported', reason: 'could not map the position to a target slice index' };
  }

  if (tViewport.getCurrentImageIdIndex() === imageIndex) {
    return { status: 'alreadyAligned' };
  }

  await utilities.jumpToSlice(tViewport.element, { imageIndex });

  return { status: 'aligned', imageIndex };
}

/**
 * The SLICE index of a volume viewport showing `worldPosition`.
 *
 * A volume exposes its acquisition imageIds flat, while it navigates by slice; for a dynamic
 * volume the two differ in both length and direction (measured on the ODELIA MR: 155 imageIds
 * ascending in z, 31 slices descending, agreeing only at the midpoint). So this reduces the
 * imageIds to their distinct positions -- which is the slice count -- and then works in that
 * space.
 *
 * The axis direction is CALIBRATED from the viewport's current state rather than assumed:
 * whichever of `s === q` or `s === M-1-q` holds for the slice it is showing now tells us how
 * its slice index runs. Assuming a direction is what produced the original mirroring bug, and
 * hardcoding the reversal the way upstream does is only correct for a plain volume.
 */
function volumeSliceIndexFor(tViewport: SyncableViewport, worldPosition: vec3): number | undefined {
  const sliceCount = tViewport.getNumberOfSlices?.();

  if (!sliceCount || sliceCount < 1) {
    return undefined;
  }

  const normal = tViewport.getCamera?.()?.viewPlaneNormal;

  if (!isUsablePosition(normal)) {
    return undefined;
  }

  // Distinct positions along the view normal, ascending. Projection rather than raw z so this
  // holds for obliquely-acquired series too.
  const project = (position: number[]) => vec3.dot(position as vec3, normal as vec3);
  const seen = new Map<string, { projection: number; position: number[] }>();

  for (const imageId of tViewport.getImageIds()) {
    const position = positionOf(imageId);

    if (!position) {
      continue;
    }

    const projection = project(position);
    const key = projection.toFixed(3);

    if (!seen.has(key)) {
      seen.set(key, { projection, position });
    }
  }

  const ascending = [...seen.values()].sort((a, b) => a.projection - b.projection);

  if (ascending.length !== sliceCount) {
    // The distinct positions should BE the slices. If they are not, this mapping is not
    // trustworthy and guessing would move the reader somewhere arbitrary.
    return undefined;
  }

  const rankOf = (target: vec3) => {
    let best = { distance: Infinity, index: -1 };
    ascending.forEach((entry, index) => {
      const distance = Math.abs(project(entry.position) - vec3.dot(target, normal as vec3));
      if (distance < best.distance) {
        best = { distance, index };
      }
    });
    return best.index;
  };

  // Calibrate: where does the slice the viewport is showing NOW sit in the ascending list?
  const currentPosition = positionOf(tViewport.getCurrentImageId?.());

  if (!currentPosition) {
    return undefined;
  }

  // Slice index is the rank in PROJECTION order, with no mirroring. Projecting onto the view
  // normal is what makes this direction-free: the normal already encodes which way the volume
  // is stacked, so slice index is monotonic with projection by construction.
  //
  // Measured on the ODELIA MR, whose normal is [0.008, 0, -0.99997], i.e. essentially -z:
  // slice 0 is z=+55.75 (projection -55.7) and slice 30 is z=-43.24 (projection +43.2). So
  // slice index ascends with projection even though it DESCENDS with z.
  //
  // Two earlier attempts got this wrong by reasoning in z and then applying a correction.
  // Calibrating the direction from the viewport's current slice is ambiguous at the midpoint
  // (`s === q` and `s === M-1-q` are both true there), and the MR happened to sit on slice 15
  // of 31; guessing a convention to break that tie then sent the heatmap's z=-23.44 to slice 6
  // instead of 24, because the rank was already in projection order. Ranking in projection
  // space needs no tie-break at all.
  const currentSlice = tViewport.getCurrentImageIdIndex();
  const currentRank = rankOf(currentPosition as vec3);

  // Self-check rather than calibration: if the viewport's own current slice does not equal its
  // projection rank, this mapping does not describe the viewport and guessing would move the
  // reader somewhere arbitrary.
  if (currentSlice !== currentRank) {
    return undefined;
  }

  return rankOf(worldPosition);
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
