/**
 * The axis a series is scrolled along, and which instance sits at each position.
 *
 * For an ordinary series this is uninteresting: one instance per slice, in the
 * order the display set holds them. For a 4D dynamic series it is the whole
 * problem. The UKA breast MRI is 155 instances that OHIF renders as **31
 * anatomical slices × 5 contrast phases**: the viewport counts "16/31" and the
 * cine bar steps through TemporalPositionIdentifier 1–5.
 *
 * The fourth dimension is called a **dimension group** here, which is
 * cornerstone's own name for it, and deliberately not "phase". Cornerstone
 * splits a 4D series on the first of `TemporalPositionIdentifier`,
 * `DiffusionBValue`, `TriggerTime`, `EchoTime`, `EchoNumber`, a vendor-private
 * b-value or `PetFrameReferenceTime` that separates it. None of those is a
 * contrast phase: even `TemporalPositionIdentifier` only asserts temporal order.
 * Calling a b-value or an echo time "phase 3 of 5" in a provenance line would be
 * this panel asserting a clinical fact about the images that nothing in them
 * supports. `groupNoun` derives the word from the tag instead, and the tag
 * travels with the axis so a snapshot can be read back the same way.
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
 * `dynamicVolumeInfo.timePoints` is OHIF's own per-group split, and each entry is
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
   * SOPInstanceUIDs in viewer slice order, one list per dimension group. Always
   * at least one list; empty overall when the series cannot be addressed
   * instance by instance.
   */
  dimensionGroups: string[][];
  /**
   * The DICOM tag cornerstone split the groups on, which is what says whether
   * they are temporal positions, b-values, echoes or something else. Undefined when
   * there is one group, and on a series that was never dynamic.
   */
  splittingTag?: string;
}

const EMPTY: SliceAxis = { sliceCount: 0, dimensionGroups: [[]] };

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
 * Every group must be complete and the same length, or the whole axis is
 * refused.
 *
 * All-or-nothing for the same reason `canAddressSlices` is: a partial mapping
 * would shift every slice number after the gap, and the panel would keep
 * reporting slice numbers that no longer mean what they say.
 */
function isUsable(groups: string[][]): boolean {
  const length = groups[0]?.length ?? 0;
  return (
    length > 0 && groups.every(group => group.length === length && group.every(uid => Boolean(uid)))
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
    const dimensionGroups = timePoints.map((imageIds: unknown) =>
      Array.isArray(imageIds)
        ? imageIds.map(id => sopInstanceUIDOf(String(id))).filter((uid): uid is string => !!uid)
        : []
    );
    // A group that lost an instance to a metadata miss is not silently shortened:
    // isUsable rejects the whole axis, and the panel falls back to the
    // middleware's own recipe rather than naming slices it cannot stand behind.
    const complete = timePoints.every(
      (ids: unknown, i: number) => Array.isArray(ids) && dimensionGroups[i].length === ids.length
    );
    if (complete && isUsable(dimensionGroups)) {
      return {
        sliceCount: dimensionGroups[0].length,
        dimensionGroups,
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
  return { sliceCount: uids.length, dimensionGroups: [uids] };
}

/** How many dimension groups the axis has. One for an ordinary series. */
export function dimensionGroupCount(axis: SliceAxis): number {
  return axis.dimensionGroups.length;
}

/**
 * What one group of this axis should be called, from the tag it was split on.
 *
 * The word is a claim about the images, so it comes from the data and not from
 * what this deployment usually sees: `phase 3 of 5` over a diffusion series would
 * be describing a b-value as a contrast phase.
 *
 * Deliberately "temporal position" and not "contrast phase" for
 * `TemporalPositionIdentifier` -- DICOM's own words for that tag, and DICOM
 * defines it as the temporal order of a dynamic or functional set. It says
 * nothing about contrast, and a non-contrast dynamic series would be mislabelled
 * by exactly the reasoning this function exists to remove. On the UKA breast MRI
 * the temporal positions *are* the contrast phases -- that is a fact about that
 * acquisition, not about the tag, and it is not this formatter's to assert.
 *
 * An unrecognised or absent tag stays the neutral "group" rather than borrowing a
 * word from a different acquisition.
 */
export function groupNoun(splittingTag?: string): string {
  switch (splittingTag) {
    case 'TemporalPositionIdentifier':
      return 'temporal position';
    case 'DiffusionBValue':
    case 'PhilipsPrivateBValue':
    case 'SiemensPrivateBValue':
    case 'GEPrivateBValue':
      return 'b-value';
    case 'EchoTime':
    case 'EchoNumber':
      return 'echo';
    case 'TriggerTime':
    case 'CardiacTriggerTime':
      return 'trigger time';
    case 'PetFrameReferenceTime':
      return 'frame time';
    case 'TimeSlotVector':
      return 'time slot';
    default:
      return 'group';
  }
}

/** The plural of `groupNoun`, since not every one of them takes a bare "s". */
export function groupNounPlural(splittingTag?: string): string {
  const noun = groupNoun(splittingTag);
  return noun === 'echo' ? 'echoes' : `${noun}s`;
}

/** The instances of one dimension group, in viewer slice order. Clamped to a real group. */
export function dimensionGroupInstances(axis: SliceAxis, groupIndex: number): string[] {
  if (axis.dimensionGroups.length === 0) {
    return [];
  }
  const index = Math.min(Math.max(0, Math.floor(groupIndex)), axis.dimensionGroups.length - 1);
  return axis.dimensionGroups[index] ?? [];
}

/**
 * Where an instance sits on the axis: which dimension group, and which slice of it.
 *
 * Used to place the "you are here" marker and to seed the group selector from
 * whatever the viewport is already showing, so the panel opens describing the
 * image the reader is looking at rather than an arbitrary group.
 */
export function positionOf(
  axis: SliceAxis,
  sopInstanceUID: string | null | undefined
): { groupIndex: number; sliceNumber: number } | null {
  if (!sopInstanceUID) {
    return null;
  }
  for (let groupIndex = 0; groupIndex < axis.dimensionGroups.length; groupIndex++) {
    const index = axis.dimensionGroups[groupIndex].indexOf(sopInstanceUID);
    if (index >= 0) {
      return { groupIndex, sliceNumber: index + 1 };
    }
  }
  return null;
}

/**
 * Whether a series can be addressed slice by slice.
 *
 * Every frame the viewer holds has to be accounted for by the axis: slices ×
 * groups. A multi-frame instance is one SOPInstanceUID covering many slices, so
 * naming it cannot express "slices 18–62" — and guessing would send different
 * pixels than the panel claims.
 */
export function canAddressAxis(axis: SliceAxis, numFrames: number): boolean {
  return axis.sliceCount > 0 && axis.sliceCount * axis.dimensionGroups.length === numFrames;
}

/** `temporal position 3 of 5` / `b-value 2 of 4`. */
export function formatDimensionGroup(
  groupIndex: number,
  count: number,
  splittingTag?: string
): string {
  return `${groupNoun(splittingTag)} ${groupIndex + 1} of ${count}`;
}

/** `31 slices × 5 temporal positions` / `103 slices`. */
export function formatAxisShape(axis: SliceAxis): string {
  const slices = `${axis.sliceCount} slice${axis.sliceCount === 1 ? '' : 's'}`;
  const groups = axis.dimensionGroups.length;
  return groups > 1 ? `${slices} × ${groups} ${groupNounPlural(axis.splittingTag)}` : slices;
}
