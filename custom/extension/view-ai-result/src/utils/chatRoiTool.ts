/**
 * A cornerstone rectangle tool that belongs to the chat panel, not to the
 * measurement record.
 *
 * The panel needs a region a radiologist can draw on the image, but a region
 * drawn to ask a question is not a clinical annotation and must not be mistaken
 * for one. This registers a tool under its own name, `ChatROI`, which gets three
 * things from being separate:
 *
 *   - OHIF's measurement service maps annotations to measurements by tool name.
 *     An unknown name has no mapping, so a chat region never enters the
 *     measurement panel, never gets tracked, and is never exported to an SR.
 *   - It renders dashed and labelled "Chat ROI", so nothing on screen reads as a
 *     saved measurement or as an AI overlay.
 *   - Clearing chat regions cannot touch the reader's own annotations, because
 *     they are different tools with different annotation records.
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

/** Dashed and amber: deliberately unlike the solid styling of a measurement. */
const CHAT_ROI_STYLES = {
  [CHAT_ROI_TOOL_NAME]: {
    color: 'rgb(251, 191, 36)',
    colorHighlighted: 'rgb(253, 224, 71)',
    colorSelected: 'rgb(253, 224, 71)',
    lineDash: '4,3',
    lineWidth: '2',
    textBoxFontSize: '12px',
    textBoxColor: 'rgb(251, 191, 36)',
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
    if (!toolGroup.hasTool?.(CHAT_ROI_TOOL_NAME) && !toolGroup._toolInstances?.[CHAT_ROI_TOOL_NAME]) {
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
  try {
    toolGroup.setToolPassive(CHAT_ROI_TOOL_NAME);
    if (previousTool) {
      toolGroup.setToolActive(previousTool, {
        bindings: [{ mouseButton: ToolEnums.MouseBindings.Primary }],
      });
    }
  } catch (error) {
    console.warn('Chat ROI tool could not be deactivated:', error);
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
