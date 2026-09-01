export const SynchronizerManager = {
  createSynchronizer: jest.fn(() => ({ add: jest.fn(), destroy: jest.fn() })),
  getSynchronizer: jest.fn(),
};
export class Synchronizer {}

// --- Annotation tooling, for the chat ROI ----------------------------------
// A tool group faithful enough to catch the mistakes that matter: which tool
// holds the primary mouse button, and whether a tool was added before use.

/**
 * Faithful in the two ways the chat ROI tool depends on:
 *
 *  - `isPointNearTool` is assigned as an *instance* property in the constructor,
 *    exactly as cornerstone does it. That is why the subclass wraps the function
 *    instead of overriding a method, and a mock with it on the prototype would
 *    make the wrong approach pass.
 *  - it answers for the rectangle's *outline* only, which is the limitation that
 *    makes a drawn region impossible to pick up by its middle.
 */
export class RectangleROITool {
  static toolName = 'RectangleROI';
  configuration: Record<string, unknown>;
  isPointNearTool: (...args: any[]) => boolean;

  constructor(props: any = {}) {
    this.configuration = props?.configuration || {};
    this.isPointNearTool = (_element: any, drawn: any, canvasCoords: number[], proximity = 6) => {
      const points = drawn?.data?.handles?.points;
      if (!points) {
        return false;
      }
      // Corners 0 and 3 are opposite, as cornerstone's own hit test reads them.
      const [x1, y1] = points[0];
      const [x2, y2] = points[3];
      const [left, right] = [Math.min(x1, x2), Math.max(x1, x2)];
      const [top, bottom] = [Math.min(y1, y2), Math.max(y1, y2)];
      const [x, y] = canvasCoords;
      const outsideX = Math.max(left - x, x - right, 0);
      const outsideY = Math.max(top - y, y - bottom, 0);
      const distance =
        outsideX > 0 || outsideY > 0
          ? Math.hypot(outsideX, outsideY)
          : Math.min(x - left, right - x, y - top, bottom - y);
      return distance <= proximity;
    };
  }
}

export const addTool = jest.fn();

export const Enums = {
  MouseBindings: { Primary: 1, Auxiliary: 4, Secondary: 2 },
  ToolModes: { Active: 'Active', Passive: 'Passive', Enabled: 'Enabled', Disabled: 'Disabled' },
  Events: {
    ANNOTATION_COMPLETED: 'ANNOTATION_COMPLETED',
    ANNOTATION_MODIFIED: 'ANNOTATION_MODIFIED',
    ANNOTATION_REMOVED: 'ANNOTATION_REMOVED',
  },
};

// Annotations a test has put on the image, by UID. Mutable objects on purpose:
// cornerstone's tools edit annotation state in place, and so does the code that
// moves a chat region between slices.
export const __annotations: Record<string, any> = {};
export const __setAnnotation = (uid: string, value: any) => {
  __annotations[uid] = value;
};
export const __resetAnnotations = () => {
  Object.keys(__annotations).forEach(k => delete __annotations[k]);
};

export const annotation = {
  config: { style: { setToolGroupToolStyles: jest.fn() } },
  state: {
    removeAnnotation: jest.fn(),
    getAnnotation: jest.fn((uid: string) => __annotations[uid]),
  },
};

export function makeToolGroup(initial: Record<string, any> = {}) {
  const group: any = {
    toolOptions: { ...initial },
    _toolInstances: Object.fromEntries(Object.keys(initial).map(k => [k, {}])),
    addTool: jest.fn((name: string) => {
      group._toolInstances[name] = {};
      group.toolOptions[name] = { mode: 'Disabled', bindings: [] };
    }),
    hasTool: jest.fn((name: string) => Boolean(group._toolInstances[name])),
    setToolActive: jest.fn((name: string, opts: any = {}) => {
      group.toolOptions[name] = { mode: 'Active', bindings: opts.bindings || [] };
    }),
    setToolPassive: jest.fn((name: string) => {
      group.toolOptions[name] = { mode: 'Passive', bindings: [] };
    }),
  };
  return group;
}

const toolGroups: Record<string, any> = {};

export const ToolGroupManager = {
  getToolGroup: jest.fn((id: string) => toolGroups[id]),
};

export const __setToolGroup = (id: string, group: any) => {
  toolGroups[id] = group;
};
export const __resetToolGroups = () => {
  Object.keys(toolGroups).forEach(k => delete toolGroups[k]);
};
