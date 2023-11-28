import Config from '../utils/config';
const config: Config = require('../utils/config.json');
import {
  ODELIA_LABELING_SOURCE_NAME,
  ODELIA_LABELING_SOURCE_VERSION,
} from '../measuermentServiceMappings/ODELIALabel';
import { DicomMetadataStore } from '@ohif/core';

const unusedColumns = [
  'AnnotationType',
  'Patient ID',
  'Patient Name',
  'StudyInstanceUID',
  'Leison ID',
];

const leisonToolColumns = ['FrameOfReferenceUID', 'points'];

export default function importCSVReport(
  { measurementService, extensionManager },
  csvData
) {
  measurementService.clearMeasurements();

  const dataSource = extensionManager.getActiveDataSource()[0];

  const label_source = measurementService.getSource(
    ODELIA_LABELING_SOURCE_NAME,
    ODELIA_LABELING_SOURCE_VERSION
  );

  const mappings = measurementService.getSourceMappings(
    ODELIA_LABELING_SOURCE_NAME,
    ODELIA_LABELING_SOURCE_VERSION
  );

  console.log('Mappings', mappings);

  const annotationType = 'ODELIALabel';

  const matchingMapping = mappings.find(
    m => m.annotationType === annotationType
  );

  console.log('Matched Mapping', matchingMapping);

  const leisonConfig = config.panel_configs.filter(
    config => config.name == 'leison table'
  )[0];

  const keys = csvData[0];

  console.log('CSV Header:', typeof keys);

  const rawMeasurements = csvData.slice(1);

  console.log(rawMeasurements);

  let parsedMeasurements: { [key: string]: string }[] = [];

  for (let i = 0; i < rawMeasurements.length; i++) {
    const values = rawMeasurements[i];
    const measurement: { [key: string]: string } = {};

    for (let j = 0; j < keys.length; j++) {
      const k = keys[j];
      measurement[k] = values[j];
    }

    parsedMeasurements.push(measurement);
  }

  let labels: any = _collateLabels(parsedMeasurements);

  Object.keys(labels).forEach(patientID => {
    const label_data = Object.keys(labels[patientID])
      .filter(key => !unusedColumns.includes(key) && !(key in leisonConfig))
      .reduce((obj, key) => {
        obj[key] = labels[patientID][key];
        return obj;
      }, {});
    const annotation = {
      annotationUID: 1,
      metadata: { source: 'imported' },
      data: {
        label_data: label_data,
      },
      referenceStudyUID: labels[patientID].StudyInstanceUID,
      toolName: 'ODELIALabel',
      displayText: 'displayText',
      type: 'ODELIALabel',
    };
    measurementService.addRawMeasurement(
      label_source,
      annotationType,
      { annotation },
      matchingMapping.toMeasurementSchema,
      dataSource
    );
  });

  const CORNERSTONE_3D_TOOLS_SOURCE_NAME = 'Cornerstone3DTools';
  const CORNERSTONE_3D_TOOLS_SOURCE_VERSION = '0.1';

  const leison_source = measurementService.getSource(
    CORNERSTONE_3D_TOOLS_SOURCE_NAME,
    CORNERSTONE_3D_TOOLS_SOURCE_VERSION
  );

  const leisonMappings = measurementService.getSourceMappings(
    CORNERSTONE_3D_TOOLS_SOURCE_NAME,
    CORNERSTONE_3D_TOOLS_SOURCE_VERSION
  );
  const leisonAnnotationType = 'CircleROI';
  console.log('Leision Mappings', leisonMappings);
  const matchingLeisonMapping = leisonMappings.find(
    m => m.annotationType === leisonAnnotationType
  );

  const leisons: any = _parseLeisons(parsedMeasurements, leisonConfig);
  leisons.forEach(annotation => {
    const uid = measurementService.addRawMeasurement(
      leison_source,
      leisonAnnotationType,
      { annotation },
      matchingLeisonMapping.toMeasurementSchema,
      dataSource
    );
    // Initialize leisons labeling table
    console.log(uid);
    const measurement = measurementService.getMeasurement(uid);
    measurement.label_data = {};
    console.log(measurement.label_data);
    measurement.label_data = annotation.data.label_data;
    measurement.label = '';
    measurementService.update(uid, measurement);
  });
}

function _collateLabels(parsedMeasurements) {
  const collatedLabels = {};
  parsedMeasurements.map(
    element => (collatedLabels[element['Patient ID']] = element)
  );
  return collatedLabels;
}

function _parseLeisons(parsedMeasurements, leisonColumns) {
  const parsedLeisions = [];
  parsedMeasurements.map(element => {
    const leision_data = Object.keys(element)
      .filter(
        key =>
          !unusedColumns.includes(key) && key in leisonColumns.label_options[0]
      )
      .reduce((obj, key) => {
        obj[key] = element[key];
        return obj;
      }, {});
    console.log(element);
    console.log(leisonColumns);
    console.log(leision_data);

    const annotation = {
      annotationUID: 1,
      metadata: {
        toolName: 'CircleROI',
        FrameOfReferenceUID: element['FrameOfReferenceUID'],
        referencedImageId: element['referencedImageId'],
      },
      data: {
        label_data: leision_data,
        cachedStats: [],
        handles: {
          textBox: {},
          points: element['points']
            .split(';')
            .map(pos => pos.split(' ').map(Number)),
        },
      },
      referenceStudyUID: element['StudyInstanceUID'],
      toolName: 'CircleROI',
      displayText: '',
      type: 'value_type::circle',
    };
    console.log(element['points']);
    parsedLeisions.push(annotation);
  });
  return parsedLeisions;
}
