export const SynchronizerManager = {
  createSynchronizer: jest.fn(() => ({ add: jest.fn(), destroy: jest.fn() })),
  getSynchronizer: jest.fn(),
};
export class Synchronizer {}

// --- Annotation tooling, for the chat ROI ----------------------------------
// A tool group faithful enough to catch the mistakes that matter: which tool
// holds the primary mouse button, and whether a tool was added before use.

export class RectangleROITool {
  static toolName = 'RectangleROI';
  configuration: Record<string, unknown>;
  constructor(props: any = {}) {
    this.configuration = props?.configuration || {};
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

export const annotation = {
  config: { style: { setToolGroupToolStyles: jest.fn() } },
  state: { removeAnnotation: jest.fn() },
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
