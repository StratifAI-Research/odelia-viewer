import { cornerstoneStreamingDynamicImageVolumeLoader } from '@cornerstonejs/core/loaders';

/**
 * Cornerstone 5.6.8 builds an active-dimension-group-first request list, but
 * BaseStreamingImageVolume.loadImages reverses it before adding it to the pool.
 * Compensate only for dynamic volumes, preserving the upstream group/slice order
 * in the final queue. Remove this adapter when the upstream reversal is fixed;
 * the queue regression test intentionally exercises the installed base loader.
 */
export default function dynamicVolumeLoader(
  ...args: Parameters<typeof cornerstoneStreamingDynamicImageVolumeLoader>
): ReturnType<typeof cornerstoneStreamingDynamicImageVolumeLoader> {
  const loadObject = cornerstoneStreamingDynamicImageVolumeLoader(...args);

  return {
    ...loadObject,
    promise: loadObject.promise.then(volume => {
      const getImageLoadRequests = volume.getImageLoadRequests.bind(volume);
      volume.getImageLoadRequests = priority => getImageLoadRequests(priority).reverse();
      return volume;
    }),
  };
}
