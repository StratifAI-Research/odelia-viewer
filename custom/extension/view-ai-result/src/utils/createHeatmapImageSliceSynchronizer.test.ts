import createHeatmapImageSliceSynchronizer from './createHeatmapImageSliceSynchronizer';
import { SynchronizerManager } from '@cornerstonejs/tools';
import { Enums } from '@cornerstonejs/core';

describe('createHeatmapImageSliceSynchronizer', () => {
  beforeEach(() => {
    (SynchronizerManager.createSynchronizer as jest.Mock).mockClear();
  });

  it('returns the synchronizer produced by SynchronizerManager', () => {
    const sync = createHeatmapImageSliceSynchronizer('heatmap-sync');
    expect(sync).toBeDefined();
    expect(typeof (sync as any).destroy).toBe('function');
    expect(SynchronizerManager.createSynchronizer).toHaveBeenCalledTimes(1);
  });

  it('wires the STACK_NEW_IMAGE event and a callback', () => {
    createHeatmapImageSliceSynchronizer('heatmap-sync');
    const [name, event, callback] = (SynchronizerManager.createSynchronizer as jest.Mock).mock.calls[0];
    expect(name).toBe('heatmap-sync');
    expect(event).toBe(Enums.Events.STACK_NEW_IMAGE);
    expect(typeof callback).toBe('function');
  });

  it('registers a VOLUME_NEW_IMAGE auxiliary event on the element', () => {
    createHeatmapImageSliceSynchronizer('heatmap-sync');
    const options = (SynchronizerManager.createSynchronizer as jest.Mock).mock.calls[0][3];
    expect(options.auxiliaryEvents).toEqual([
      { name: Enums.Events.VOLUME_NEW_IMAGE, source: 'element' },
    ]);
  });

  it('forwards caller-supplied options into the synchronizer config', () => {
    createHeatmapImageSliceSynchronizer('heatmap-sync', { useInitialPosition: false });
    const options = (SynchronizerManager.createSynchronizer as jest.Mock).mock.calls[0][3];
    expect(options.useInitialPosition).toBe(false);
    // Custom options must not clobber the auxiliary-event wiring.
    expect(options.auxiliaryEvents).toHaveLength(1);
  });
});
