// `any` for the isolated custom typecheck (@ohif shimmed to any). Swap back to
// `import type { Button } from '@ohif/core/types'` when real types are wired.
type Button = any;

// Command definition reused by all tool buttons
const setToolActiveCmd = {
  commandName: 'setToolActive',
  commandOptions: {
    toolGroupIds: ['default'],
  },
  context: 'CORNERSTONE',
};

const toolbarButtons: Button[] = [
  {
    id: 'Zoom',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-zoom',
      label: 'Zoom',
      tooltip: 'Zoom',
      commands: {
        ...setToolActiveCmd,
        commandOptions: {
          ...setToolActiveCmd.commandOptions,
          toolName: 'Zoom',
        },
      },
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'Pan',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-move',
      label: 'Pan',
      tooltip: 'Pan',
      commands: {
        ...setToolActiveCmd,
        commandOptions: {
          ...setToolActiveCmd.commandOptions,
          toolName: 'Pan',
        },
      },
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'WindowLevel',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-window-level',
      label: 'W/L',
      tooltip: 'Window/Level',
      commands: {
        ...setToolActiveCmd,
        commandOptions: {
          ...setToolActiveCmd.commandOptions,
          toolName: 'WindowLevel',
        },
      },
      evaluate: 'evaluate.cornerstoneTool',
    },
  },
  {
    id: 'Reset',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'tool-reset',
      label: 'Reset',
      tooltip: 'Reset View',
      commands: 'resetViewport',
      evaluate: 'evaluate.action',
    },
  },
  {
    id: 'ImageSliceSync',
    uiType: 'ohif.toolButton',
    props: {
      icon: 'link',
      label: 'Slice Sync',
      tooltip: 'Toggle scroll synchronization between viewports',
      commands: 'toggleHeatmapImageSliceSync',
      evaluate: 'evaluate.heatmapSync',
    },
  },
];

export default toolbarButtons;
