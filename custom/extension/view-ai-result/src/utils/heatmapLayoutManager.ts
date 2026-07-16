import { AIResult } from '../types';

interface LayoutConfig {
  viewportId: string;
  displaySets: any[];
  viewportOptions: any;
  aiResult: AIResult;
  viewportGridService: any;
  servicesManager: any;
}

interface CapturedViewport {
  displaySetInstanceUIDs: string[];
  viewportOptions: any;
  displaySetOptions: any[];
}

interface CapturedLayout {
  layout: { numRows: number; numCols: number; layoutType: string; layoutOptions: any[] };
  viewports: CapturedViewport[];
  activeViewportId: string | undefined;
  isHangingProtocolLayout: boolean;
}

// Prior grid state captured when a heatmap is opened, so closing it restores the
// user's layout (hanging protocol, multi-viewport, viewport options,
// multi-display-set) instead of collapsing to a generic single viewport (H-14).
// Keyed by the viewport grid service instance (a singleton in the app; a fresh
// object per test) so snapshots never leak across services.
const savedLayoutsByService = new WeakMap<object, Record<string, CapturedLayout>>();

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
          displaySetInstanceUIDs: [aiResult.heatmapDisplaySet?.displaySetInstanceUID].filter(
            Boolean
          ),
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

  /** Snapshot one viewport's restorable state (defensive copies). */
  private static snapshotViewport(vp: any): CapturedViewport {
    return {
      displaySetInstanceUIDs: Array.isArray(vp?.displaySetInstanceUIDs)
        ? [...vp.displaySetInstanceUIDs]
        : [],
      viewportOptions: vp?.viewportOptions ? { ...vp.viewportOptions } : {},
      displaySetOptions: Array.isArray(vp?.displaySetOptions) ? [...vp.displaySetOptions] : [{}],
    };
  }

  /**
   * Capture the current grid state so it can be restored when the heatmap
   * closes. Returns `null` when the service can't report state (older/mock
   * services) — callers then fall back to the legacy single-viewport layout.
   */
  private static captureLayout(viewportGridService: any): CapturedLayout | null {
    if (!viewportGridService || typeof viewportGridService.getState !== 'function') {
      return null;
    }
    let state: any;
    try {
      state = viewportGridService.getState();
    } catch {
      return null;
    }
    if (!state || !state.layout) {
      return null;
    }

    const source = state.viewports;
    const viewports: CapturedViewport[] = [];
    if (source instanceof Map) {
      source.forEach(vp => viewports.push(this.snapshotViewport(vp)));
    } else if (Array.isArray(source)) {
      source.forEach(vp => viewports.push(this.snapshotViewport(vp)));
    } else if (source && typeof source === 'object') {
      Object.values(source).forEach(vp => viewports.push(this.snapshotViewport(vp)));
    }
    if (!viewports.length) {
      return null;
    }

    return {
      layout: {
        numRows: state.layout.numRows,
        numCols: state.layout.numCols,
        layoutType: state.layout.layoutType || 'grid',
        layoutOptions: state.layout.layoutOptions || [],
      },
      viewports,
      activeViewportId: state.activeViewportId,
      isHangingProtocolLayout:
        state.isHangingProtocolLayout ?? state.layout.isHangingProtocolLayout ?? false,
    };
  }

  /** Rebuild the grid from a captured snapshot. */
  private static restoreLayout(saved: CapturedLayout, viewportGridService: any) {
    viewportGridService.setLayout({
      numRows: saved.layout.numRows,
      numCols: saved.layout.numCols,
      layoutType: saved.layout.layoutType,
      layoutOptions: saved.layout.layoutOptions,
      activeViewportId: saved.activeViewportId,
      isHangingProtocolLayout: saved.isHangingProtocolLayout,
      findOrCreateViewport: (position: number) => {
        const vp = saved.viewports[position];
        if (!vp) {
          return null;
        }
        return {
          displaySetInstanceUIDs: vp.displaySetInstanceUIDs,
          viewportOptions: vp.viewportOptions,
          displaySetOptions: vp.displaySetOptions,
        };
      },
    });
  }

  static toggleHeatmapLayout(showHeatmap: boolean, config: LayoutConfig) {
    if (!config.aiResult?.hasHeatmap || !config.aiResult.heatmapDisplaySet) {
      return;
    }

    const { viewportGridService } = config;
    const baseViewportId = config.viewportId.replace(/-heatmap.*$/, '');

    if (showHeatmap) {
      // Capture the layout we're replacing so closing can restore it.
      const snapshot = this.captureLayout(viewportGridService);
      if (snapshot) {
        let byId = savedLayoutsByService.get(viewportGridService);
        if (!byId) {
          byId = {};
          savedLayoutsByService.set(viewportGridService, byId);
        }
        byId[baseViewportId] = snapshot;
      }
      this.createSideBySideLayout(config);
    } else {
      const byId = savedLayoutsByService.get(viewportGridService);
      const saved = byId?.[baseViewportId];
      if (saved) {
        this.restoreLayout(saved, viewportGridService);
        delete byId[baseViewportId];
      } else {
        // No captured state (heatmap was never opened via this manager, or the
        // service can't report state): fall back to the legacy single layout.
        this.createSingleLayout(config);
      }
    }
  }
}
