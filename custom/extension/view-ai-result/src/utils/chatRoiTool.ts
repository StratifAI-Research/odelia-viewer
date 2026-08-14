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
import {
  addTool,
  annotation,
  RectangleROITool,
  ToolGroupManager,
  Enums as ToolEnums,
} from '@cornerstonejs/tools';

export const CHAT_ROI_TOOL_NAME = 'ChatROI';

/**
 * A rectangle that reports what it is instead of what it measures.
 *
 * Subclassed only to claim a distinct tool name; the drawing behaviour of
 * RectangleROITool is exactly what is wanted. `getTextLines` is replaced so the
 * label reads "Chat ROI" rather than an area and a mean intensity — statistics
 * would invite the region to be read as a measurement, which is the confusion
 * this whole module exists to prevent.
 */
class ChatRoiTool extends RectangleROITool {
  static toolName = CHAT_ROI_TOOL_NAME;

  constructor(props: Record<string, unknown> = {}) {
    super({
      ...props,
      configuration: {
        ...((props.configuration as Record<string, unknown>) || {}),
        getTextLines: () => ['Chat ROI'],
      },
    } as never);
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
