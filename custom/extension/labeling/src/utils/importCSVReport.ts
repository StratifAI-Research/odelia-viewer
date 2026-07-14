import Config from '../utils/config';
import { getPanelConfig } from '../utils/panelConfig';
const config: Config = require('../utils/config.json');
import {
  ODELIA_LABELING_SOURCE_NAME,
  ODELIA_LABELING_SOURCE_VERSION,
} from '../measurementServiceMappings/ODELIALabel';
import { utils } from '@ohif/core';

const unusedColumns = [
  'AnnotationType',
  'Patient ID',
  'Patient Name',
  'StudyInstanceUID',
  // Kept spelled 'Leison ID' verbatim: this matches the column name emitted by
  // the external annotation-export producer, not code we own. Renaming it here
  // would stop the (misspelled) foreign column from being filtered out.
  'Leison ID',
  'Label',
];

// Lesion geometry/metadata columns — never part of an ODELIA label's label_data.
const lesionToolColumns = ['FrameOfReferenceUID', 'points', 'referencedImageId'];

export default function importCSVReport(
  { measurementService, extensionManager },
  csvData: { [key: string]: string }[]
) {
  measurementService.clearMeasurements();

  const dataSource = extensionManager.getActiveDataSource()[0];

  const labelSource = measurementService.getSource(
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

  const lesionConfig = getPanelConfig(config, 'lesion table');

  // CSVImporter parses with Papa `header: true`, so csvData is already one
  // object per row keyed by the header names — exactly the shape
  // _collateLabels and _parseLesions expect. (This previously zipped
  // csvData[0] as a header array against csvData.slice(1) as value arrays,
  // which yielded empty rows and then crashed on undefined `points` once
  // header:true was introduced upstream.)
  const parsedMeasurements: { [key: string]: string }[] = csvData;

  let labels: any = _collateLabels(parsedMeasurements);

  Object.keys(labels).forEach(patientID => {
    const label_data = Object.keys(labels[patientID])
      // Keep only label-panel columns: drop identifiers, lesion geometry, and
      // lesion-label columns (the last mirrors _parseLesions' filter below).
      // Previously `!(key in lesionConfig)` tested the config object's own keys
      // (name/label_options), so lesion columns leaked into the label.
      .filter(
        key =>
          !unusedColumns.includes(key) &&
          !lesionToolColumns.includes(key) &&
          !(key in lesionConfig.label_options[0])
      )
      .reduce((obj, key) => {
        obj[key] = labels[patientID][key];
        return obj;
      }, {});
    const annotation = {
      annotationUID: utils.guid(),
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
      labelSource,
      annotationType,
      { annotation },
      matchingMapping.toMeasurementSchema,
      dataSource
    );
  });

  const CORNERSTONE_3D_TOOLS_SOURCE_NAME = 'Cornerstone3DTools';
  const CORNERSTONE_3D_TOOLS_SOURCE_VERSION = '0.1';

  const lesionSource = measurementService.getSource(
    CORNERSTONE_3D_TOOLS_SOURCE_NAME,
    CORNERSTONE_3D_TOOLS_SOURCE_VERSION
  );

  const lesionMappings = measurementService.getSourceMappings(
    CORNERSTONE_3D_TOOLS_SOURCE_NAME,
    CORNERSTONE_3D_TOOLS_SOURCE_VERSION
  );
  const lesionAnnotationType = 'CircleROI';
  console.log('Lesion Mappings', lesionMappings);
  const matchingLesionMapping = lesionMappings.find(
    m => m.annotationType === lesionAnnotationType
  );

  const lesions: any = _parseLesions(parsedMeasurements, lesionConfig);
  lesions.forEach(annotation => {
    const uid = measurementService.addRawMeasurement(
      lesionSource,
      lesionAnnotationType,
      { annotation },
      matchingLesionMapping.toMeasurementSchema,
      dataSource
    );
    // Initialize lesions labeling table
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

function _parseLesions(parsedMeasurements, lesionColumns) {
  const parsedLesions: any[] = [];
  parsedMeasurements.forEach(element => {
    // Only rows carrying lesion geometry become lesion annotations; label-only
    // rows have no `points`, so skip them (guards element['points'].split).
    if (!element['points']) {
      return;
    }

    const lesionData = Object.keys(element)
      .filter(
        key =>
          !unusedColumns.includes(key) && key in lesionColumns.label_options[0]
      )
      .reduce((obj, key) => {
        obj[key] = element[key];
        return obj;
      }, {});
    console.log(element);
    console.log(lesionColumns);
    console.log(lesionData);

    const annotation = {
      annotationUID: utils.guid(),
      metadata: {
        toolName: 'CircleROI',
        FrameOfReferenceUID: element['FrameOfReferenceUID'],
        referencedImageId: element['referencedImageId'],
      },
      data: {
        label_data: lesionData,
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
    parsedLesions.push(annotation);
  });
  return parsedLesions;
}
