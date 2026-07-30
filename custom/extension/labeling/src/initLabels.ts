import Config from './utils/config';
import {
  ODELIA_LABELING_SOURCE_NAME,
  ODELIA_LABELING_SOURCE_VERSION,
} from './measurementServiceMappings/ODELIALabel';
import { makeLabelAnnotation } from './measurementServiceMappings/makeLabelAnnotation';
const config: Config = require('./utils/config.json');
export default function initLabels({ measurementService, extensionManager, StudyInstanceUID }) {
  // getMeasurements() returns an array; destructuring `{ measurements }` off it
  // yielded undefined and defeated the "already inited" guard below, so labels
  // were re-hydrated on every call.
  const measurements = measurementService.getMeasurements();
  const dataSource = extensionManager.getActiveDataSource()[0];

  const source = measurementService.getSource(
    ODELIA_LABELING_SOURCE_NAME,
    ODELIA_LABELING_SOURCE_VERSION
  );

  const mappings = measurementService.getSourceMappings(
    ODELIA_LABELING_SOURCE_NAME,
    ODELIA_LABELING_SOURCE_VERSION
  );
  const annotationType = 'ODELIALabel';

  // Skip only when THIS study already has an ODELIALabel measurement — not any
  // measurement (e.g. a lesion CircleROI), which would wrongly suppress init.
  if (
    measurements &&
    measurements.some(
      element => element.type === 'ODELIALabel' && element.referenceStudyUID === StudyInstanceUID
    )
  ) {
    return;
  }
  const label_data = {};

  Object.keys(config.panel_configs).forEach(panel_config => {
    const label_options = Object.assign({}, ...config.panel_configs[panel_config].label_options);
    Object.keys(label_options).forEach(element => {
      if (label_options[element].options) {
        label_data[element] = label_options[element].options[0];
      } else {
        // Leave undated (option-less) labels empty rather than fabricating
        // a 1970-01-01 epoch that reads as a real clinical date. The DatePicker
        // and export path already treat empty as "unset".
        label_data[element] = '';
      }
    });
  });
  const annotation = makeLabelAnnotation({
    labelData: label_data,
    referenceStudyUID: StudyInstanceUID,
    source: 'inited',
  });
  if (!mappings || !mappings.length) {
    throw new Error(
      `Attempting to hydrate measurements service when no mappings present. This shouldn't be reached.`
    );
  }

  const matchingMapping = mappings.find(m => m.annotationType === annotationType);
  measurementService.addRawMeasurement(
    source,
    annotationType,
    { annotation },
    matchingMapping.toMeasurementSchema,
    dataSource
  );
}
