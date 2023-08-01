import Config from "../utils/config";
const config: Config = require('../utils/config.json');
import { ODELIA_LABELING_SOURCE_NAME, ODELIA_LABELING_SOURCE_VERSION } from "../measuermentServiceMappings/ODELIALabel";
import { DicomMetadataStore } from '@ohif/core';

const unusedColumns = ["AnnotationType", "Patient ID", "Patient Name", "StudyInstanceUID", "Leison ID"]

export default function importCSVReport({ measurementService, extensionManager }, csvData) {
  const { measurements } = measurementService.getMeasurements()
  measurementService.clearMeasurements()
  const dataSource = extensionManager.getActiveDataSource()[0]

  const source = measurementService.getSource(ODELIA_LABELING_SOURCE_NAME, ODELIA_LABELING_SOURCE_VERSION)

  const mappings = measurementService.getSourceMappings(
    ODELIA_LABELING_SOURCE_NAME, ODELIA_LABELING_SOURCE_VERSION);

  const annotationType = "ODELIALabel"
  const matchingMapping = mappings.find(
    m => m.annotationType === annotationType,
  );

  const leisonConfig = config.panel_configs.filter(config => config.name == 'leison table')[0]

  console.log(leisonConfig)

  const keys = csvData[0];
  const rawMeasurements = csvData.slice(1)
  console.log(rawMeasurements)
  let parsedMeasurements = rawMeasurements.map(values => {
    return Object.assign(...keys.map((k, i) => ({ [k]: values[i] })));
  })
  let labels: any = _collateLabels(parsedMeasurements)
  Object.keys(labels).forEach(patientID => {
    const label_data = Object.keys(labels[patientID])
      .filter((key) => !(unusedColumns.includes(key)) && !(key in leisonConfig))
      .reduce((obj, key) => {
        obj[key] = labels[patientID][key];
        return obj;
      }, {})
    const annotation = {
      annotationUID: 1,
      metadata: { source: "imported" },
      data: {
        label_data: label_data
      },
      referenceStudyUID: labels[patientID].StudyInstanceUID,
      toolName: "ODELIALabel",
      displayText: "displayText",
      type: "ODELIALabel",
    }
    measurementService.addRawMeasurement(
      source,
      annotationType,
      { annotation },
      matchingMapping.toMeasurementSchema,
      dataSource
    );
  })

}



function _collateLabels(parsedMeasurements) {
  const collatedLabels = {}
  parsedMeasurements.map(element => collatedLabels[element["Patient ID"]] = element)
  return collatedLabels
}

function _parseLeisons({ StudyInstanceUID, csvData }) {


}
