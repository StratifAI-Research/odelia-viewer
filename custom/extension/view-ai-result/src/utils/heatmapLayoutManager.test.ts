import { HeatmapLayoutManager } from './heatmapLayoutManager';

const makeConfig = (overrides: any = {}) => {
  const setLayout = jest.fn();
  const config = {
    viewportId: 'viewport-0',
    displaySets: [{ displaySetInstanceUID: 'primary-ds' }],
    viewportOptions: { orientation: 'axial' },
    aiResult: {
      hasHeatmap: true,
      heatmapDisplaySet: { displaySetInstanceUID: 'heatmap-ds' },
    },
    viewportGridService: { setLayout },
    servicesManager: {},
    ...overrides,
  };
  return { config, setLayout };
};

describe('HeatmapLayoutManager.toggleHeatmapLayout', () => {
  it('does nothing when the AI result has no heatmap', () => {
    const { config, setLayout } = makeConfig({ aiResult: { hasHeatmap: false, heatmapDisplaySet: {} } });
    HeatmapLayoutManager.toggleHeatmapLayout(true, config);
    expect(setLayout).not.toHaveBeenCalled();
  });

  it('does nothing when the heatmap display set is missing', () => {
    const { config, setLayout } = makeConfig({ aiResult: { hasHeatmap: true, heatmapDisplaySet: undefined } });
    HeatmapLayoutManager.toggleHeatmapLayout(true, config);
    expect(setLayout).not.toHaveBeenCalled();
  });

  it('builds a 1x2 side-by-side layout when showing the heatmap', () => {
    const { config, setLayout } = makeConfig();
    HeatmapLayoutManager.toggleHeatmapLayout(true, config);

    expect(setLayout).toHaveBeenCalledTimes(1);
    const arg = setLayout.mock.calls[0][0];
    expect(arg).toMatchObject({ numRows: 1, numCols: 2, layoutType: 'grid', activeViewportId: 'viewport-0' });
    expect(arg.layoutOptions).toEqual([
      { x: 0, y: 0, width: 0.5, height: 1 },
      { x: 0.5, y: 0, width: 0.5, height: 1 },
    ]);

    const primary = arg.findOrCreateViewport(0);
    expect(primary.displaySetInstanceUIDs).toEqual(['primary-ds']);
    expect(primary.viewportOptions).toMatchObject({ viewportId: 'viewport-0', viewportType: 'volume' });

    const heatmap = arg.findOrCreateViewport(1);
    expect(heatmap.displaySetInstanceUIDs).toEqual(['heatmap-ds']);
    expect(heatmap.viewportOptions).toMatchObject({
      viewportId: 'viewport-0-heatmap',
      viewportType: 'stack',
      showOverlays: false,
    });

    expect(arg.findOrCreateViewport(2)).toBeNull();
  });

  it('strips an existing -heatmap suffix from the base viewport id', () => {
    const { config, setLayout } = makeConfig({ viewportId: 'viewport-3-heatmap-extra' });
    HeatmapLayoutManager.toggleHeatmapLayout(true, config);
    const arg = setLayout.mock.calls[0][0];
    expect(arg.findOrCreateViewport(0).viewportOptions.viewportId).toBe('viewport-3');
    expect(arg.findOrCreateViewport(1).viewportOptions.viewportId).toBe('viewport-3-heatmap');
  });

  it('builds a 1x1 single layout when hiding the heatmap', () => {
    const { config, setLayout } = makeConfig();
    HeatmapLayoutManager.toggleHeatmapLayout(false, config);

    expect(setLayout).toHaveBeenCalledTimes(1);
    const arg = setLayout.mock.calls[0][0];
    expect(arg).toMatchObject({ numRows: 1, numCols: 1, activeViewportId: 'viewport-0' });
    expect(arg.layoutOptions).toEqual([{ x: 0, y: 0, width: 1, height: 1 }]);

    const single = arg.findOrCreateViewport();
    expect(single.displaySetInstanceUIDs).toEqual(['primary-ds']);
    expect(single.viewportOptions).toMatchObject({ viewportId: 'viewport-0', viewportType: 'volume' });
  });

  it('filters out undefined display set UIDs in the single layout', () => {
    const { config, setLayout } = makeConfig({ displaySets: [] });
    HeatmapLayoutManager.toggleHeatmapLayout(false, config);
    const arg = setLayout.mock.calls[0][0];
    expect(arg.findOrCreateViewport().displaySetInstanceUIDs).toEqual([]);
  });

  it('captures the prior layout on open and restores it on close (H-14)', () => {
    const setLayout = jest.fn();
    const priorState = {
      activeViewportId: 'viewport-0',
      isHangingProtocolLayout: true,
      layout: {
        numRows: 1,
        numCols: 2,
        layoutType: 'grid',
        layoutOptions: [
          { x: 0, y: 0, width: 0.5, height: 1 },
          { x: 0.5, y: 0, width: 0.5, height: 1 },
        ],
      },
      viewports: new Map([
        [
          'viewport-0',
          {
            displaySetInstanceUIDs: ['ds-a', 'ds-b'],
            viewportOptions: { viewportType: 'volume', orientation: 'sagittal' },
            displaySetOptions: [{}, {}],
          },
        ],
        [
          'viewport-1',
          {
            displaySetInstanceUIDs: ['ds-c'],
            viewportOptions: { viewportType: 'stack' },
            displaySetOptions: [{}],
          },
        ],
      ]),
    };
    const viewportGridService = { setLayout, getState: jest.fn(() => priorState) };
    const { config } = makeConfig({ viewportGridService });

    // Open: captures the state and builds the side-by-side layout.
    HeatmapLayoutManager.toggleHeatmapLayout(true, config);
    expect(viewportGridService.getState).toHaveBeenCalled();
    expect(setLayout.mock.calls[0][0]).toMatchObject({ numCols: 2 });

    // Close: restores the captured 2-up multi-display-set layout, not a generic
    // single volume viewport.
    HeatmapLayoutManager.toggleHeatmapLayout(false, config);
    const closeArg = setLayout.mock.calls[1][0];
    expect(closeArg).toMatchObject({
      numRows: 1,
      numCols: 2,
      activeViewportId: 'viewport-0',
      isHangingProtocolLayout: true,
    });
    const vp0 = closeArg.findOrCreateViewport(0);
    expect(vp0.displaySetInstanceUIDs).toEqual(['ds-a', 'ds-b']);
    expect(vp0.viewportOptions).toMatchObject({ viewportType: 'volume', orientation: 'sagittal' });
    expect(closeArg.findOrCreateViewport(1).displaySetInstanceUIDs).toEqual(['ds-c']);
    expect(closeArg.findOrCreateViewport(2)).toBeNull();
  });

  it('falls back to the single layout on close when nothing was captured', () => {
    const { config, setLayout } = makeConfig();
    // No prior open and a service without getState -> legacy single layout.
    HeatmapLayoutManager.toggleHeatmapLayout(false, config);
    expect(setLayout.mock.calls[0][0]).toMatchObject({ numRows: 1, numCols: 1 });
  });
});
