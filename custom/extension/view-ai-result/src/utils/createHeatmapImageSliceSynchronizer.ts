import { SynchronizerManager, Synchronizer } from '@cornerstonejs/tools';
import {
  Enums,
  getRenderingEngine,
  metaData,
  utilities,
  Types,
} from '@cornerstonejs/core';
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

  // Matching is purely spatial, on imagePositionPatient -- see the note at the jump below
  // for why no index adjustment may be layered on top of it.
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

  // `closestResult.index` is already the spatially correct slice: it is whichever target
  // image sits nearest the registered source position, found by comparing
  // imagePositionPatient above. Nothing further may be applied to it.
  //
  // This used to reverse the index for a volume source and a stack target
  // (`targetImageIds.length - index - 1`), on the premise that "volume displays in reverse
  // of anatomical order". That premise is false for these series, and the reversal was the
  // cause of the heatmap tracking the wrong way: measured against the ODELIA study, the MR
  // volume's imageIds and the heatmap stack's are BOTH ascending in z (both run
  // -43.24 -> 55.75), and the volume's own index maps monotonically onto that order.
  // Reversing therefore turned a correct match into a mirrored one -- MR index 12 (z
  // -3.64) drove the heatmap to 18 (z 16.16) instead of 12, and index 25 to 5 instead of
  // 25, both exactly 31 - index - 1. A spatial match and an index reversal are mutually
  // exclusive; keep the spatial one.
  if (closestResult.index !== -1 && tViewport.getCurrentImageIdIndex() !== closestResult.index) {
    await utilities.jumpToSlice(tViewport.element, {
      imageIndex: closestResult.index,
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
          name: Enums.Events.VOLUME_NEW_IMAGE, // Use the constant, not string literal!
          source: 'element',
        },
      ],
    }
  );

  return synchronizer;
}
