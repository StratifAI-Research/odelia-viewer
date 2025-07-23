/**
 * Returns a data URI thumbnail for given cornerstone imageId.
 * @param {*} cornerstone - cornerstone library (from getCornerstoneLibraries())
 * @param {string} imageId - the cornerstone imageId to load
 * @returns {Promise<string>} resolves to base64 data URI
 */
function getImageSrcFromImageId(cornerstone, imageId) {
  return new Promise((resolve, reject) => {
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
