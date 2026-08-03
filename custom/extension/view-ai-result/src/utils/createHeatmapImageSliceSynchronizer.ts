import { SynchronizerManager, Synchronizer } from '@cornerstonejs/tools';
import { Enums, getRenderingEngine, Types } from '@cornerstonejs/core';
import alignHeatmapSlice from './alignHeatmapSlice';

/**
 * Image slice sync callback - copied from Cornerstone3D since it's not exported.
 *
 * Resolves the two viewports and delegates the slice choice to alignHeatmapSlice, which
 * toggleHeatmapImageSliceSync also calls directly to align on enable rather than waiting
 * for the next slice-change event.
 */
async function imageSliceSyncCallback(
  synchronizerInstance: Synchronizer,
  sourceViewport: Types.IViewportId,
  targetViewport: Types.IViewportId
): Promise<void> {
  const renderingEngine = getRenderingEngine(targetViewport.renderingEngineId);
  if (!renderingEngine) {
    throw new Error(`No RenderingEngine for Id: ${targetViewport.renderingEngineId}`);
  }

  const sViewport = renderingEngine.getViewport(sourceViewport.viewportId) as any;
  const tViewport = renderingEngine.getViewport(targetViewport.viewportId) as any;

  const options = synchronizerInstance.getOptions(targetViewport.viewportId);

  if (options?.disabled) {
    return;
  }

  await alignHeatmapSlice(sViewport, tViewport, {
    useInitialPosition: options?.useInitialPosition as boolean | undefined,
    sourceViewportId: sourceViewport.viewportId,
    targetViewportId: targetViewport.viewportId,
  });
}

/**
 * Creates an image slice synchronizer with VOLUME_NEW_IMAGE auxiliary event support
 * This ensures synchronization works for both stack and volume viewports
 *
 * This bypasses the bug in Cornerstone3D's createImageSliceSynchronizer which uses
 * the string literal 'VOLUME_NEW_IMAGE' instead of the constant Enums.Events.VOLUME_NEW_IMAGE
 */
export default function createHeatmapImageSliceSynchronizer(
  synchronizerName: string,
  options?: Record<string, unknown>
): Synchronizer {
  const { createSynchronizer } = SynchronizerManager;

  // Create synchronizer directly with correct event constant
  const synchronizer = createSynchronizer(
    synchronizerName,
    Enums.Events.STACK_NEW_IMAGE,
    imageSliceSyncCallback,
    {
      ...options,
      auxiliaryEvents: [
        {
          name: Enums.Events.VOLUME_NEW_IMAGE, // Use the constant, not string literal!
          source: 'element',
        },
      ],
    }
  );

  return synchronizer;
}
