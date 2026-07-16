import { SynchronizerManager, Synchronizer } from '@cornerstonejs/tools';
import { Enums, getRenderingEngine, metaData, utilities, VolumeViewport, Types } from '@cornerstonejs/core';
import { vec3, mat4 } from 'gl-matrix';

/**
 * Image slice sync callback - copied from Cornerstone3D since it's not exported
 * This handles the synchronization logic between viewports
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

  // Get source image position
  const sourceImageIndex = sViewport.getCurrentImageIdIndex();
  const sourceImageIds = sViewport.getImageIds();

  // Note: We rely on spatial position matching (imagePositionPatient) rather than manual index reversal
  // The volume→stack reversal is handled later (line ~104) when setting the target index

  const sourceImageId = sourceImageIds[sourceImageIndex];
  const imagePlaneModule1 = metaData.get('imagePlaneModule', sourceImageId);
  const sourceImagePositionPatient = imagePlaneModule1.imagePositionPatient;
  const targetImageIds = tViewport.getImageIds();

  // Check if viewports are coplanar (simplified check)
  const frameOfReferenceUID1 = sViewport.getFrameOfReferenceUID();
  const frameOfReferenceUID2 = tViewport.getFrameOfReferenceUID();

  if (frameOfReferenceUID1 !== frameOfReferenceUID2) {
    console.warn('[HeatmapSync] Different Frame of Reference, skipping sync');
    return;
  }

  // Get or calculate spatial registration
  let registrationMatrixMat4 = utilities.spatialRegistrationMetadataProvider.get(
    'spatialRegistrationModule',
    targetViewport.viewportId,
    sourceViewport.viewportId
  );

  if (!registrationMatrixMat4) {
    if (frameOfReferenceUID1 === frameOfReferenceUID2 && options?.useInitialPosition !== false) {
      registrationMatrixMat4 = mat4.identity(mat4.create());
    } else {
      utilities.calculateViewportsSpatialRegistration(sViewport, tViewport);
      registrationMatrixMat4 = utilities.spatialRegistrationMetadataProvider.get(
        'spatialRegistrationModule',
        targetViewport.viewportId,
        sourceViewport.viewportId
      );
    }

    if (!registrationMatrixMat4) {
      console.error('[HeatmapSync] Could not calculate registration matrix');
      return;
    }
  }

  // Calculate target position with registration matrix
  const targetImagePositionPatient = vec3.transformMat4(
    vec3.create(),
    sourceImagePositionPatient,
    registrationMatrixMat4
  );

  // Find closest image index
  const closestResult = targetImageIds.reduce(
    (closest, imageId, index) => {
      const { imagePositionPatient } = metaData.get('imagePlaneModule', imageId);
      const distance = vec3.distance(imagePositionPatient, targetImagePositionPatient);

      if (distance < closest.distance) {
        return { distance, index };
      }
      return closest;
    },
    { distance: Infinity, index: -1 }
  );

  // Handle index reversal for volume→stack synchronization
  let imageIndexToSet = closestResult.index;

  // If source is volume and target is stack, reverse the target index
  // because volume displays in reverse of anatomical order
  if (sViewport instanceof VolumeViewport && !(tViewport instanceof VolumeViewport)) {
    imageIndexToSet = targetImageIds.length - closestResult.index - 1;
  }

  if (closestResult.index !== -1 && tViewport.getCurrentImageIdIndex() !== closestResult.index) {
    await utilities.jumpToSlice(tViewport.element, {
      imageIndex: imageIndexToSet,
    });
  }
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
          name: Enums.Events.VOLUME_NEW_IMAGE,  // Use the constant, not string literal!
          source: 'element'
        }
      ]
    }
  );

  return synchronizer;
}
