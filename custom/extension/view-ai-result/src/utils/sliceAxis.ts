/**
 * The axis a series is scrolled along, and which instance sits at each position.
 *
 * For an ordinary series this is uninteresting: one instance per slice, in the
 * order the display set holds them. For a 4D dynamic series it is the whole
 * problem. The UKA breast MRI is 155 instances that OHIF renders as **31
 * anatomical slices × 5 contrast phases**: the viewport counts "16/31" and the
 * cine bar steps through TemporalPositionIdentifier 1–5.
 *
 * Reading the 155 instances as 155 slices — which the panel used to do — is wrong
 * in three separate ways, and only one of them is visible:
 *
 *   - The viewer's slice numbers (1–31) and the panel's (1–155) are different
 *     scales, so the marker showing "you are here" lands nowhere near the right
 *     place.
 *   - `displaySet.images` is interleaved by phase (1,2,3,4,5,1,2,3,4,5…), so
 *     five evenly spaced picks off that list are five *different contrast
 *     phases*. On a dynamic study the enhancement differences between them are
 *     timing, not anatomy, and nothing tells the model that.
 *   - That list is also ordered opposite to the volume: `images[0]` is
 *     InstanceNumber 151, while volume slice 1 is InstanceNumber 1.
 *
 * `dynamicVolumeInfo.timePoints` is OHIF's own per-phase split, and each entry is
 * in volume order. Verified against the running viewer: with the viewport on
 * "I:106 (22/31)", `timePoints[0][21]` resolves to InstanceNumber 106.
 *
 * Instances are named by SOPInstanceUID here, as everywhere else in the panel,
 * because that is what the middleware addresses slices by.
 */

import { metaData } from '@cornerstonejs/core';

export interface SliceAxis {
  /** Positions on the axis, matching the number the viewer counts against. */
  sliceCount: number;
  /**
   * SOPInstanceUIDs in viewer slice order, one list per phase. Always at least
   * one list; empty overall when the series cannot be addressed instance by
   * instance.
   */
  phases: string[][];
  /** The DICOM tag the phases were split on. Undefined when there is one phase. */
  splittingTag?: string;
}

const EMPTY: SliceAxis = { sliceCount: 0, phases: [[]] };

/** SOPInstanceUID for a cornerstone imageId, or null if it cannot be resolved. */
function sopInstanceUIDOf(imageId: string): string | null {
  try {
    const general = metaData.get('generalImageModule', imageId) as any;
    const uid = general?.sopInstanceUID;
    return typeof uid === 'string' && uid.length > 0 ? uid : null;
  } catch (_) {
    // metaData providers throw on an unknown imageId in some builds.
    return null;
  }
}

/**
 * Every phase must be complete and the same length, or the whole axis is
 * refused.
 *
 * All-or-nothing for the same reason `canAddressSlices` is: a partial mapping
 * would shift every slice number after the gap, and the panel would keep
 * reporting slice numbers that no longer mean what they say.
 */
function isUsable(phases: string[][]): boolean {
  const length = phases[0]?.length ?? 0;
  return (
    length > 0 && phases.every(phase => phase.length === length && phase.every(uid => Boolean(uid)))
  );
}

/**
 * The slice axis of a display set.
 *
 * `displaySet` is typed loosely because OHIF's DisplaySet type carries neither
 * `dynamicVolumeInfo` nor `images`, both of which are present at runtime.
 */
export function sliceAxisOf(displaySet: any): SliceAxis {
  const info = displaySet?.dynamicVolumeInfo;
  const timePoints = info?.timePoints;

  if (info?.isDynamicVolume && Array.isArray(timePoints) && timePoints.length > 0) {
    const phases = timePoints.map((imageIds: unknown) =>
      Array.isArray(imageIds)
        ? imageIds.map(id => sopInstanceUIDOf(String(id))).filter((uid): uid is string => !!uid)
        : []
    );
    // A phase that lost an instance to a metadata miss is not silently shortened:
    // isUsable rejects the whole axis, and the panel falls back to the
    // middleware's own recipe rather than naming slices it cannot stand behind.
    const complete = timePoints.every(
      (ids: unknown, i: number) => Array.isArray(ids) && phases[i].length === ids.length
    );
    if (complete && isUsable(phases)) {
      return {
        sliceCount: phases[0].length,
        phases,
        splittingTag: info.splittingTag,
      };
    }
    return EMPTY;
  }

  const instances: any[] = displaySet?.images || displaySet?.instances || [];
  const uids = instances.map(i => i?.SOPInstanceUID).filter((uid): uid is string => !!uid);
  if (uids.length === 0 || uids.length !== instances.length) {
    return EMPTY;
  }
  return { sliceCount: uids.length, phases: [uids] };
}

/** How many phases the axis has. One for an ordinary series. */
export function phaseCount(axis: SliceAxis): number {
  return axis.phases.length;
}

/** The instances of one phase, in viewer slice order. Clamped to a real phase. */
export function phaseInstances(axis: SliceAxis, phaseIndex: number): string[] {
  if (axis.phases.length === 0) {
    return [];
  }
  const index = Math.min(Math.max(0, Math.floor(phaseIndex)), axis.phases.length - 1);
  return axis.phases[index] ?? [];
}

/**
 * Where an instance sits on the axis: which phase, and which slice of it.
 *
 * Used to place the "you are here" marker and to seed the phase selector from
 * whatever the viewport is already showing, so the panel opens describing the
 * image the reader is looking at rather than an arbitrary phase.
 */
export function positionOf(
  axis: SliceAxis,
  sopInstanceUID: string | null | undefined
): { phaseIndex: number; sliceNumber: number } | null {
  if (!sopInstanceUID) {
    return null;
  }
  for (let phaseIndex = 0; phaseIndex < axis.phases.length; phaseIndex++) {
    const index = axis.phases[phaseIndex].indexOf(sopInstanceUID);
    if (index >= 0) {
      return { phaseIndex, sliceNumber: index + 1 };
    }
  }
  return null;
}

/**
 * Whether a series can be addressed slice by slice.
 *
 * Every frame the viewer holds has to be accounted for by the axis: slices ×
 * phases. A multi-frame instance is one SOPInstanceUID covering many slices, so
 * naming it cannot express "slices 18–62" — and guessing would send different
 * pixels than the panel claims.
 */
export function canAddressAxis(axis: SliceAxis, numFrames: number): boolean {
  return axis.sliceCount > 0 && axis.sliceCount * axis.phases.length === numFrames;
}

/** `phase 3 of 5`. */
export function formatPhase(phaseIndex: number, count: number): string {
  return `phase ${phaseIndex + 1} of ${count}`;
}

/** `31 slices × 5 phases` / `103 slices`. */
export function formatAxisShape(axis: SliceAxis): string {
  const slices = `${axis.sliceCount} slice${axis.sliceCount === 1 ? '' : 's'}`;
  return axis.phases.length > 1 ? `${slices} × ${axis.phases.length} phases` : slices;
}
