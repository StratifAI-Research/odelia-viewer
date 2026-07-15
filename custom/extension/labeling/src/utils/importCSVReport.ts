import Config from '../utils/config';
import { getPanelConfig } from '../utils/panelConfig';
const config: Config = require('../utils/config.json');
import {
  ODELIA_LABELING_SOURCE_NAME,
  ODELIA_LABELING_SOURCE_VERSION,
} from '../measurementServiceMappings/ODELIALabel';
import { utils } from '@ohif/core';
import { makeLabelAnnotation } from '../measurementServiceMappings/makeLabelAnnotation';

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
  // Validate inputs and resolve every source/mapping BEFORE mutating the
  // measurement service. A malformed CSV or an unregistered source/mapping must
  // not leave the reader with cleared measurements and a half-done import, so no
  // clearMeasurements()/addRawMeasurement() runs until parsing has fully
  // succeeded below.
  if (!Array.isArray(csvData) || csvData.length === 0) {
    throw new Error('importCSVReport: no rows to import');
  }

  const dataSource = extensionManager.getActiveDataSource()?.[0];
  if (!dataSource) {
    throw new Error('importCSVReport: no active data source');
  }

  const annotationType = 'ODELIALabel';
  const labelSource = measurementService.getSource(
    ODELIA_LABELING_SOURCE_NAME,
    ODELIA_LABELING_SOURCE_VERSION
  );
  const mappings =
    measurementService.getSourceMappings(
      ODELIA_LABELING_SOURCE_NAME,
      ODELIA_LABELING_SOURCE_VERSION
    ) || [];
  const matchingMapping = mappings.find(m => m.annotationType === annotationType);
  if (!labelSource || !matchingMapping) {
    throw new Error('importCSVReport: ODELIALabel source/mapping is not registered');
  }

  const lesionConfig = getPanelConfig(config, 'lesion table');

  // CSVImporter parses with Papa `header: true`, so csvData is already one
  // object per row keyed by the header names — exactly the shape
  // _collateLabels and _parseLesions expect.
  // Build the full plan (label + lesion annotations) first; a parse error here
  // throws before anything is cleared, preserving existing measurements.
  const collatedLabels: any = _collateLabels(csvData);
  const labelAnnotations = Object.keys(collatedLabels).map(studyKey => {
    const row = collatedLabels[studyKey];
    const label_data = Object.keys(row)
      // Keep only label-panel columns: drop identifiers, lesion geometry, and
      // lesion-label columns (the last mirrors _parseLesions' filter below).
      .filter(
        key =>
          !unusedColumns.includes(key) &&
          !lesionToolColumns.includes(key) &&
          !(key in lesionConfig.label_options[0])
      )
      .reduce((obj, key) => {
        obj[key] = row[key];
        return obj;
      }, {});
    return makeLabelAnnotation({
      labelData: label_data,
      referenceStudyUID: row.StudyInstanceUID,
      source: 'imported',
    });
  });

  const lesionAnnotations: any[] = _parseLesions(csvData, lesionConfig);

  // Resolve the lesion (CircleROI) source/mapping, but only require it when
  // there are lesion rows to add. A label-only CSV produces no lesion
  // annotations and must not require the Cornerstone3DTools mapping — a
  // deployment using labeling without it still imports study/patient labels.
  const CORNERSTONE_3D_TOOLS_SOURCE_NAME = 'Cornerstone3DTools';
  const CORNERSTONE_3D_TOOLS_SOURCE_VERSION = '0.1';
  const lesionAnnotationType = 'CircleROI';
  const lesionSource = measurementService.getSource(
    CORNERSTONE_3D_TOOLS_SOURCE_NAME,
    CORNERSTONE_3D_TOOLS_SOURCE_VERSION
  );
  const lesionMappings =
    measurementService.getSourceMappings(
      CORNERSTONE_3D_TOOLS_SOURCE_NAME,
      CORNERSTONE_3D_TOOLS_SOURCE_VERSION
    ) || [];
  const matchingLesionMapping = lesionMappings.find(
    m => m.annotationType === lesionAnnotationType
  );
  if (lesionAnnotations.length > 0 && (!lesionSource || !matchingLesionMapping)) {
    throw new Error(
      'importCSVReport: Cornerstone3DTools/CircleROI source/mapping is not registered'
    );
  }

  // Apply atomically: only now that parsing/validation succeeded do we clear
  // existing measurements and add the imported ones.
  measurementService.clearMeasurements();

  labelAnnotations.forEach(annotation => {
    measurementService.addRawMeasurement(
      labelSource,
      annotationType,
      { annotation },
      matchingMapping.toMeasurementSchema,
      dataSource
    );
  });

  lesionAnnotations.forEach(annotation => {
    const uid = measurementService.addRawMeasurement(
      lesionSource,
      lesionAnnotationType,
      { annotation },
      matchingLesionMapping.toMeasurementSchema,
      dataSource
    );
    // Seed the lesion's labeling table from the imported label_data. `label` is
    // '' to mark it imported; LabelingTable no longer wipes label_data for such
    // measurements (see seedDefaultLabelData).
    const measurement = measurementService.getMeasurement(uid);
    measurement.label_data = annotation.data.label_data;
    measurement.label = '';
    measurementService.update(uid, measurement);
  });
}

// Collate label rows by StudyInstanceUID so a patient with multiple studies
// yields one label per study. Previously this keyed solely on 'Patient ID', so
// for a multi-study patient only the last row survived (and it set the single
// label's referenceStudyUID). Falls back to 'Patient ID' for rows without a
// StudyInstanceUID.
function _collateLabels(parsedMeasurements) {
  const collatedLabels = {};
  parsedMeasurements.forEach(element => {
    const key = element['StudyInstanceUID'] || element['Patient ID'];
    collatedLabels[key] = element;
  });
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

    parsedLesions.push(annotation);
  });
  return parsedLesions;
}
