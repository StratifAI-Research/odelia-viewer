/**
 * Returns a data URI thumbnail for given cornerstone imageId.
 * @param cornerstone - cornerstone library (from getCornerstoneLibraries())
 * @param imageId - the cornerstone imageId to load
 * @returns resolves to base64 data URI
 */
function getImageSrcFromImageId(cornerstone, imageId): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const canvas = document.createElement('canvas');
    cornerstone.utilities
      .loadImageToCanvas({ canvas, imageId, thumbnail: true })
      .then(() => {
        resolve(canvas.toDataURL());
      })
      .catch(reject);
  });
}

export default getImageSrcFromImageId;
