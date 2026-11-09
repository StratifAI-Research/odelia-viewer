import { cornerstoneStreamingDynamicImageVolumeLoader } from '@cornerstonejs/core/loaders';

/**
 * Cornerstone 5.6.8 builds an active-dimension-group-first request list, but
 * BaseStreamingImageVolume.loadImages reverses it before adding it to the pool.
 * Compensate only during that loader's synchronous queue construction. Custom
 * strategies (including MPR's nth loader) call getImageLoadRequests directly
 * and must retain its original ordering.
 * Remove this adapter when the upstream reversal is fixed;
 * the queue regression test intentionally exercises the installed base loader.
 */
export default function dynamicVolumeLoader(
  ...args: Parameters<typeof cornerstoneStreamingDynamicImageVolumeLoader>
): ReturnType<typeof cornerstoneStreamingDynamicImageVolumeLoader> {
  const loadObject = cornerstoneStreamingDynamicImageVolumeLoader(...args);

  return {
    ...loadObject,
    promise: loadObject.promise.then(volume => {
      const loadImages = volume.loadImages;
      volume.loadImages = (...loadArgs) => {
        const getImageLoadRequests = volume.getImageLoadRequests;
        volume.getImageLoadRequests = priority =>
          getImageLoadRequests.call(volume, priority).reverse();
        try {
          return loadImages.apply(volume, loadArgs);
        } finally {
          // loadImages queues synchronously; restore before its promise settles,
          // including when request construction or queue insertion throws.
          volume.getImageLoadRequests = getImageLoadRequests;
        }
      };
      return volume;
    }),
  };
}
