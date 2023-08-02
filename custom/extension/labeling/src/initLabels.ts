import Config from "./utils/config";
const config: Config = require('./utils/config.json');
import { ODELIA_LABELING_SOURCE_NAME, ODELIA_LABELING_SOURCE_VERSION } from "./measuermentServiceMappings/ODELIALabel";
export default function initLabels({ measurementService, extensionManager, StudyInstanceUID }) {
  const { measurements } = measurementService.getMeasurements()
  const dataSource = extensionManager.getActiveDataSource()[0]

  const source = measurementService.getSource(ODELIA_LABELING_SOURCE_NAME, ODELIA_LABELING_SOURCE_VERSION)

  const mappings = measurementService.getSourceMappings(
    ODELIA_LABELING_SOURCE_NAME, ODELIA_LABELING_SOURCE_VERSION);
  const annotationType = "ODELIALabel"

  console.log(StudyInstanceUID)

  if (measurements && measurements.some((element) => element.referenceStudyUID == StudyInstanceUID)) {
    console.log("Measurement already inited, skipping")
    return
  }
  const label_data = {}

  Object.keys(config.panel_configs).forEach(panel_config => {
    const label_options = Object.assign({}, ...config.panel_configs[panel_config].label_options)
    Object.keys(label_options).forEach(element => {
      if (label_options[element].options) {
        label_data[element] = label_options[element].options[0]
      }
      else {
        label_data[element] = "19700101"
      }
    });
  })
  const annotation = {
    annotationUID: 1,
    metadata: { source: "inited" },
    data: { label_data: label_data },
    referenceStudyUID: StudyInstanceUID,
    toolName: "ODELIALabel",
    displayText: "displayText",
    type: "ODELIALabel",
  }
  if (!mappings || !mappings.length) {
    throw new Error(
      `Attempting to hydrate measurements service when no mappings present. This shouldn't be reached.`
    );
  }

  const matchingMapping = mappings.find(
    m => m.annotationType === annotationType,
  );
  measurementService.addRawMeasurement(
    source,
    annotationType,
    { annotation },
    matchingMapping.toMeasurementSchema,
    dataSource
  );
}
