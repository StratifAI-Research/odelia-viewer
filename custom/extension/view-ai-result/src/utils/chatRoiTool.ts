/**
 * A cornerstone rectangle tool that belongs to the chat panel, not to the
 * measurement record.
 *
 * The panel needs a region a radiologist can draw on the image, but a region
 * drawn to ask a question is not a clinical annotation and must not be mistaken
 * for one. This registers a tool under its own name, `ChatROI`, which gets two
 * things from being separate:
 *
 *   - It renders dashed and labelled "Chat ROI", in amber rather than the green
 *     of a selected measurement, so nothing on screen reads as a saved finding or
 *     as an AI overlay.
 *   - Clearing chat regions cannot touch the reader's own annotations, because
 *     they are different tools with different annotation records.
 *
 * What a distinct name does NOT buy is exclusion from OHIF's measurement service.
 * The bridge in `extensions/cornerstone/src/initMeasurementService.ts` forwards
 * every annotation it sees, and `MeasurementService.addUnmappedMeasurement`
 * deliberately keeps the ones it has no mapping for. So a chat region does appear
 * in `getMeasurements()`, and a clinical "clear measurements" will delete its
 * annotation. That is survivable but must not be silent: the panel watches for
 * its region disappearing (see `useChatRoiCapture`) and drops it, rather than
 * cropping the next message to a rectangle no longer on screen.
 *
 * Everything here is imperative and talks to cornerstone's global state, which is
 * why the geometry lives in `chatRoi.ts` instead.
 */
import { getEnabledElement } from '@cornerstonejs/core';
import {
  addTool,
  annotation,
  RectangleROITool,
  ToolGroupManager,
  Enums as ToolEnums,
} from '@cornerstonejs/tools';
import { isPointInsideCorners } from './chatRoi';

export const CHAT_ROI_TOOL_NAME = 'ChatROI';

/**
 * Whether the pointer is over the body of a chat region.
 *
 * Cornerstone decides what a mouse-down is for by asking each tool whether the
 * point is "near" it, so widening that answer to the rectangle's interior is what
 * makes the whole rectangle draggable — the move itself is cornerstone's, and
 * needs nothing else.
 *
 * Corners are read as `points[0]` and `points[3]`, the same pair RectangleROITool
 * uses for its own hit test. A viewport that cannot be resolved answers "not
 * over it": claiming the pointer is on a region we cannot locate would swallow a
 * window/level drag for no reason.
 */
function isPointInsideRoi(element: unknown, drawn: any, canvasCoords: number[]): boolean {
  try {
    const viewport = (getEnabledElement as any)?.(element)?.viewport;
    const points = drawn?.data?.handles?.points;
    if (!viewport?.worldToCanvas || !Array.isArray(points) || points.length < 4) {
      return false;
    }
    return isPointInsideCorners(
      canvasCoords,
      viewport.worldToCanvas(points[0]),
      viewport.worldToCanvas(points[3])
    );
  } catch (_) {
    return false;
  }
}

/**
 * A rectangle that reports what it is instead of what it measures, and can be
 * dragged by its middle.
 *
 * Subclassed only to claim a distinct tool name; the drawing behaviour of
 * RectangleROITool is exactly what is wanted. `getTextLines` is replaced so the
 * label reads "Chat ROI" rather than an area and a mean intensity — statistics
 * would invite the region to be read as a measurement, which is the confusion
 * this whole module exists to prevent.
 */
export class ChatRoiTool extends RectangleROITool {
  static toolName = CHAT_ROI_TOOL_NAME;

  constructor(props: Record<string, unknown> = {}) {
    super({
      ...props,
      configuration: {
        ...((props.configuration as Record<string, unknown>) || {}),
        getTextLines: () => ['Chat ROI'],
      },
    } as never);

    // Wrapped rather than overridden: RectangleROITool assigns `isPointNearTool`
    // as an instance property inside its own constructor, so there is nothing on
    // the prototype for a subclass method to override or `super` to reach.
    //
    // The outline test is kept and the interior added to it, not substituted for
    // it: the corner handles are how the region gets resized, and they are found
    // through the outline.
    const self = this as any;
    const nearOutline = self.isPointNearTool;
    self.isPointNearTool = (
      element: unknown,
      drawn: any,
      canvasCoords: number[],
      proximity: number,
      interactionType: string
    ) =>
      Boolean(nearOutline?.call(self, element, drawn, canvasCoords, proximity, interactionType)) ||
      isPointInsideRoi(element, drawn, canvasCoords);
  }
}

/**
 * Dashed and amber: deliberately unlike the solid styling of a measurement.
 *
 * Every colour needs its Highlighted and Selected variants too. Cornerstone
 * resolves a style by appending the annotation's state to the property name, and
 * a freshly drawn annotation is *selected* — so leaving those out leaves the
 * label and its link line at cornerstone's default selected green, which is
 * exactly the colour a selected measurement wears. The whole point of styling
 * this tool is that it cannot be mistaken for one.
 */
const AMBER = 'rgb(251, 191, 36)';
const AMBER_BRIGHT = 'rgb(253, 224, 71)';

const CHAT_ROI_STYLES = {
  [CHAT_ROI_TOOL_NAME]: {
    color: AMBER,
    colorHighlighted: AMBER_BRIGHT,
    colorSelected: AMBER_BRIGHT,
    colorLocked: AMBER,
    lineDash: '4,3',
    lineWidth: '2',
    textBoxFontSize: '12px',
    textBoxColor: AMBER,
    textBoxColorHighlighted: AMBER_BRIGHT,
    textBoxColorSelected: AMBER_BRIGHT,
    textBoxLinkLineColor: AMBER,
    textBoxLinkLineColorHighlighted: AMBER_BRIGHT,
    textBoxLinkLineColorSelected: AMBER_BRIGHT,
    textBoxLinkLineDash: '2,2',
  },
};

// cornerstone's `addTool` registers into a global registry and throws on a
// repeat. The panel can mount more than once per page (mode changes, remounts),
// so registration is done once and remembered.
let isRegistered = false;

function registerToolOnce(): void {
  if (isRegistered) {
    return;
  }
  try {
    addTool(ChatRoiTool as never);
  } catch (_) {
    // Already registered by an earlier mount. Harmless: the registry is global
    // and the entry is the same class.
  }
  isRegistered = true;
}

/**
 * Make the chat ROI tool available on a tool group, without disturbing it.
 *
 * Added as passive: present and rendering its annotations, but not bound to a
 * mouse button until the user asks to draw. Left active it would take over the
 * primary button and break window/level for anyone who never opens the chat.
 *
 * @returns whether the tool is usable on this tool group
 */
export function ensureChatRoiTool(toolGroupId = 'default'): boolean {
  const toolGroup = ToolGroupManager.getToolGroup(toolGroupId) as any;
  if (!toolGroup) {
    return false;
  }
  registerToolOnce();

  try {
    if (
      !toolGroup.hasTool?.(CHAT_ROI_TOOL_NAME) &&
      !toolGroup._toolInstances?.[CHAT_ROI_TOOL_NAME]
    ) {
      toolGroup.addTool(CHAT_ROI_TOOL_NAME);
    }
    toolGroup.setToolPassive(CHAT_ROI_TOOL_NAME);
    annotation.config.style.setToolGroupToolStyles(toolGroupId, CHAT_ROI_STYLES as never);
    return true;
  } catch (error) {
    console.warn('Chat ROI tool could not be added to the tool group:', error);
    return false;
  }
}

/**
 * Bind the chat ROI tool to the primary mouse button.
 *
 * Returns the tool that held the primary button, so the caller can hand it back
 * — leaving window/level unbound after one region is drawn would be a surprising
 * way to break the viewer.
 */
export function startDrawingRoi(toolGroupId = 'default'): string | null {
  const toolGroup = ToolGroupManager.getToolGroup(toolGroupId) as any;
  if (!toolGroup || !ensureChatRoiTool(toolGroupId)) {
    return null;
  }

  const previous = primaryToolOf(toolGroup);
  try {
    if (previous) {
      toolGroup.setToolPassive(previous);
    }
    toolGroup.setToolActive(CHAT_ROI_TOOL_NAME, {
      bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
    });
  } catch (error) {
    console.warn('Chat ROI tool could not be activated:', error);
    // The displaced tool has already been made passive by this point, so
    // returning here would leave the viewer with no primary tool at all — the
    // reader would silently lose window/level for the rest of the session.
    restorePrimary(toolGroup, previous);
    return null;
  }
  return previous;
}

/** Hand the primary button back to whatever held it before. */
export function stopDrawingRoi(previousTool: string | null, toolGroupId = 'default'): void {
  const toolGroup = ToolGroupManager.getToolGroup(toolGroupId) as any;
  if (!toolGroup) {
    return;
  }
  // Separate try blocks: if releasing the region tool throws, the previous tool
  // must still get its button back. Sharing one block skipped the restore.
  try {
    toolGroup.setToolPassive(CHAT_ROI_TOOL_NAME);
  } catch (error) {
    console.warn('Chat ROI tool could not be deactivated:', error);
  }
  restorePrimary(toolGroup, previousTool);
}

/** Give a tool the primary mouse button back, tolerating a refusal. */
function restorePrimary(toolGroup: any, toolName: string | null): void {
  if (!toolName) {
    return;
  }
  try {
    toolGroup.setToolActive(toolName, {
      bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
    });
  } catch (error) {
    console.warn(`${toolName} could not be restored to the primary button:`, error);
  }
}

/** Which tool currently holds the primary mouse button, if any. */
function primaryToolOf(toolGroup: any): string | null {
  const options = toolGroup?.toolOptions || {};
  const primary = ToolEnums.MouseBindings.Primary;
  for (const [name, option] of Object.entries<any>(options)) {
    if (name === CHAT_ROI_TOOL_NAME) {
      continue;
    }
    const active = option?.mode === 'Active' || option?.mode === ToolEnums.ToolModes?.Active;
    if (active && option?.bindings?.some((b: any) => b?.mouseButton === primary)) {
      return name;
    }
  }
  return null;
}

/**
 * A distance along the view normal below which a region is already on the slice.
 *
 * Millimetres, and far below any slice spacing in use: the point is to stop a
 * region being nudged by floating-point residue after it has just been moved,
 * not to tolerate a real gap.
 */
const ON_PLANE_TOLERANCE_MM = 1e-3;

/**
 * Bring a chat region onto the slice the viewport is showing.
 *
 * A cornerstone annotation lives in world space, on the plane it was drawn on.
 * Scrolling away does not merely hide it — it puts it out of reach: nothing is
 * rendered, so there is nothing to grab, and the panel is left showing a chip for
 * a region the reader can neither see nor move. That is fine while the prompt is
 * pinned, where the region is meant to stay on the slice it was drawn on. It is
 * not fine while the prompt follows the viewer, which is a promise that what the
 * message carries is what is on screen.
 *
 * The move is a rigid translation along the view normal, so every in-plane
 * coordinate is untouched: the same rectangle, on a different slice. The caller
 * owns the slice NUMBER — the panel resolves that through the series axis, which
 * is the only source that is right on a 4D series.
 *
 * Cornerstone records the plane an annotation belongs to in several places, and
 * they all have to move together. The one that decides whether a volume viewport
 * will show it is `metadata.planeRestriction.point`, NOT the handles: measured
 * against the running viewer, an annotation whose corners had been translated
 * onto the current slice was still filtered out, because the restriction point
 * had been left on the slice it was drawn on.
 *
 * @returns whether the region had to move
 */
export function moveChatRoiToViewportSlice(annotationUID: string, viewport: any): boolean {
  if (!annotationUID) {
    return false;
  }
  try {
    const drawn = annotation.state.getAnnotation?.(annotationUID) as any;
    const points: number[][] = drawn?.data?.handles?.points;
    const camera = viewport?.getCamera?.();
    const normal: number[] = camera?.viewPlaneNormal;
    const focal: number[] = camera?.focalPoint;
    if (!Array.isArray(points) || points.length === 0 || !normal || !focal) {
      return false;
    }

    // How far the region's plane sits from the viewport's, along the normal. Any
    // one corner answers for all four: they are coplanar and the planes are
    // parallel, which is what makes this a translation and not a reprojection.
    const [x, y, z] = points[0];
    const distance =
      (x - focal[0]) * normal[0] + (y - focal[1]) * normal[1] + (z - focal[2]) * normal[2];
    if (!Number.isFinite(distance) || Math.abs(distance) < ON_PLANE_TOLERANCE_MM) {
      return false;
    }

    // Each array is moved once however many places point at it. Cornerstone
    // hands the same array to more than one field — `planeRestriction.point` and
    // `cameraFocalPoint` are one object, not two — and shifting it per field
    // moved the plane twice as far as the rectangle, leaving the region filtered
    // out of the very slice it was supposed to have landed on.
    const moved = new Set<unknown>();
    const shift = (point: unknown) => {
      if (!Array.isArray(point) || moved.has(point)) {
        return;
      }
      moved.add(point);
      for (let i = 0; i < 3; i++) {
        point[i] -= distance * normal[i];
      }
    };
    points.forEach(shift);
    // The label travels with it, or its leader line is left pointing at the
    // slice the region came from.
    shift(drawn?.data?.handles?.textBox?.worldPosition);
    // The two places cornerstone records the plane itself. `planeRestriction` is
    // the one a volume viewport filters on; `cameraFocalPoint` is where the
    // annotation was captured from, and lies on the same plane.
    const metadata = drawn?.metadata ?? {};
    shift(metadata.planeRestriction?.point);
    shift(metadata.cameraFocalPoint);

    // Position along the normal, in cornerstone's own terms — what
    // `isReferenceViewable` compares against on a volume viewport. Taken from
    // the viewport rather than counted here, and left alone if it will not say.
    const sliceIndex = viewport?.getSliceIndex?.();
    if (Number.isFinite(sliceIndex)) {
      metadata.sliceIndex = sliceIndex;
    }

    // Only a stack viewport is filtered by the referenced image:
    // `filterAnnotationsForDisplay` asks a stack whether the annotation
    // references the image on screen, while a volume decides from the plane. So
    // it is set where it decides visibility, and left alone where
    // `getCurrentImageId` is not trustworthy — on a dynamic volume it has been
    // measured returning the instance for a different slice entirely.
    const onAVolume = ((viewport?.getAllVolumeIds?.() as string[]) ?? []).length > 0;
    const imageId = onAVolume ? null : viewport?.getCurrentImageId?.();
    if (imageId) {
      metadata.referencedImageId = imageId;
    }

    drawn.invalidated = true;
    viewport?.render?.();
    return true;
  } catch (error) {
    console.warn('Chat ROI could not be moved to the current slice:', error);
    return false;
  }
}

/**
 * Erase a chat region.
 *
 * Removal is by the annotation's own UID rather than by clearing the tool's
 * annotations wholesale, so a second chat region — or anything else on the image
 * — is left untouched.
 */
export function removeChatRoi(annotationUID: string): void {
  if (!annotationUID) {
    return;
  }
  try {
    annotation.state.removeAnnotation(annotationUID);
  } catch (error) {
    console.warn('Chat ROI annotation could not be removed:', error);
  }
}
