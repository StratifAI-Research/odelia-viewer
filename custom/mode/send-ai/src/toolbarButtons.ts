import type { Button } from '@ohif/core/types';

/**
 * Toolbar buttons this mode adds on top of the cornerstone extension's
 * `cornerstone.toolbarButtons` pack, which the mode references (see index.tsx)
 * so the standard Zoom / Pan / W-L / Reset buttons are not restated here.
 *
 * The id is deliberately NOT `ImageSliceSync`: upstream already registers a
 * button with that id (toggleSynchronizer / imageSlice) and `register()` keeps
 * the first definition for any given id, so reusing it would silently resolve to
 * whichever pack happened to register first.
 */
const toolbarButtons: Button[] = [
  {
    id: 'HeatmapSliceSync',
    uiType: 'ohif.toolButton',
    props: {
      id: 'HeatmapSliceSync',
      icon: 'link',
      label: 'Slice Sync',
      tooltip: 'Toggle scroll synchronization between the image and heatmap viewports',
      commands: 'toggleHeatmapImageSliceSync',
      evaluate: 'evaluate.heatmapSync',
    },
  },
];

export default toolbarButtons;
