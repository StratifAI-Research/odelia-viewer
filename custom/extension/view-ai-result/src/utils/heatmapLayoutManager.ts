import { AIResult } from '../types';

interface LayoutConfig {
  viewportId: string;
  displaySets: any[];
  viewportOptions: any;
  aiResult: AIResult;
  viewportGridService: any;
  servicesManager: any;
}

export class HeatmapLayoutManager {
  private static createSideBySideLayout(config: LayoutConfig) {
    const { viewportId, displaySets, viewportOptions, aiResult, viewportGridService } = config;

    // Clean viewportId to prevent concatenation (remove existing -heatmap suffix)
    const baseViewportId = viewportId.replace(/-heatmap.*$/, '');
    const primaryViewportId = baseViewportId;
    const heatmapViewportId = `${baseViewportId}-heatmap`;

    const layoutOptions = [
      { x: 0, y: 0, width: 0.5, height: 1 }, // Primary viewport (left)
      { x: 0.5, y: 0, width: 0.5, height: 1 }, // Heatmap viewport (right)
    ];

    const findOrCreateViewport = (position: number) => {
      if (position === 0) {
        // Primary viewport
        return {
          displaySetInstanceUIDs: [displaySets[0]?.displaySetInstanceUID].filter(Boolean),
          viewportOptions: {
            ...viewportOptions,
            viewportId: primaryViewportId,
            viewportType: 'volume',
          },
          displaySetOptions: [{}],
        };
      } else if (position === 1) {
        // Heatmap viewport
        return {
          displaySetInstanceUIDs: [aiResult.heatmapDisplaySet?.displaySetInstanceUID].filter(Boolean),
          viewportOptions: {
            ...viewportOptions,
            viewportId: heatmapViewportId,
            viewportType: 'stack',
            showOverlays: false,
          },
          displaySetOptions: [{}],
        };
      }
      return null;
    };

    viewportGridService.setLayout({
      numRows: 1,
      numCols: 2,
      layoutType: 'grid',
      layoutOptions,
      findOrCreateViewport,
      activeViewportId: primaryViewportId,
      isHangingProtocolLayout: false,
    });
  }

  private static createSingleLayout(config: Omit<LayoutConfig, 'aiResult'>) {
    const { viewportId, displaySets, viewportOptions, viewportGridService } = config;

    // Clean viewportId to get base ID
    const baseViewportId = viewportId.replace(/-heatmap.*$/, '');

    const findOrCreateViewport = () => ({
      displaySetInstanceUIDs: [displaySets[0]?.displaySetInstanceUID].filter(Boolean),
      viewportOptions: {
        ...viewportOptions,
        viewportId: baseViewportId,
        viewportType: 'volume',
      },
      displaySetOptions: [{}],
    });

    viewportGridService.setLayout({
      numRows: 1,
      numCols: 1,
      layoutType: 'grid',
      layoutOptions: [{ x: 0, y: 0, width: 1, height: 1 }],
      findOrCreateViewport,
      activeViewportId: baseViewportId,
      isHangingProtocolLayout: false,
    });
  }

  static toggleHeatmapLayout(showHeatmap: boolean, config: LayoutConfig) {

    if (!config.aiResult?.hasHeatmap || !config.aiResult.heatmapDisplaySet) {

      return;
    }

    if (showHeatmap) {

      this.createSideBySideLayout(config);
    } else {

      this.createSingleLayout(config);
    }
  }
}
