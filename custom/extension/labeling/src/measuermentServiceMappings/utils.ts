import * as cornerstone from '@cornerstonejs/core';

export default function getSOPInstanceAttributes(
  imageId,
  cornerstoneViewportService = undefined,
  viewportId = undefined
) {
  const instance = cornerstone.metaData.get('instance', imageId);

  return {
    SOPInstanceUID: instance.SOPInstanceUID,
    SeriesInstanceUID: instance.SeriesInstanceUID,
    StudyInstanceUID: instance.StudyInstanceUID,
    frameNumber: instance.frameNumber || 1,
  };
}
