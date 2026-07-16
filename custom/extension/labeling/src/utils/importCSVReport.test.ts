// @ohif/core is a webpack external, unresolvable in this package's jest env;
// importCSVReport (via makeLabelAnnotation) only needs utils.guid().
import importCSVReport from './importCSVReport';
import { ODELIA_LABELING_SOURCE_NAME } from '../measurementServiceMappings/ODELIALabel';

jest.mock('@ohif/core', () => ({ utils: { guid: () => 'test-guid' } }), {
  virtual: true,
});

function makeServices(labelMappingOverride?: any[]) {
  const measurementService = {
    clearMeasurements: jest.fn(),
    getSource: jest.fn((name: string) => ({ name })),
    getSourceMappings: jest.fn((name: string) => {
      if (name === ODELIA_LABELING_SOURCE_NAME) {
        return labelMappingOverride !== undefined
          ? labelMappingOverride
          : [{ annotationType: 'ODELIALabel', toMeasurementSchema: (x: any) => x }];
      }
      return [{ annotationType: 'CircleROI', toMeasurementSchema: (x: any) => x }];
    }),
    addRawMeasurement: jest.fn(() => 'uid-1'),
    getMeasurement: jest.fn(() => ({})),
    update: jest.fn(),
  };
  const extensionManager = {
    getActiveDataSource: jest.fn(() => [{ id: 'ds' }]),
  };
  return { measurementService, extensionManager };
}

describe('importCSVReport', () => {
  it('does not clear existing measurements when the label mapping is unregistered (LAB-M7)', () => {
    const { measurementService, extensionManager } = makeServices([]); // no ODELIALabel mapping
    const rows = [{ 'Patient ID': 'P1', StudyInstanceUID: 'S1', Ethnicity: 'A' }];
    expect(() => importCSVReport({ measurementService, extensionManager } as any, rows)).toThrow();
    expect(measurementService.clearMeasurements).not.toHaveBeenCalled();
    expect(measurementService.addRawMeasurement).not.toHaveBeenCalled();
  });

  it('throws without clearing on empty input (LAB-M7)', () => {
    const { measurementService, extensionManager } = makeServices();
    expect(() => importCSVReport({ measurementService, extensionManager } as any, [])).toThrow();
    expect(measurementService.clearMeasurements).not.toHaveBeenCalled();
  });

  it('imports label-only rows even when the lesion mapping is not registered', () => {
    // A label-only CSV (no `points`) must not require the Cornerstone3DTools /
    // CircleROI lesion source+mapping, which a labeling-only deployment may lack.
    const measurementService = {
      clearMeasurements: jest.fn(),
      getSource: jest.fn((name: string) =>
        name === ODELIA_LABELING_SOURCE_NAME ? { name } : null
      ),
      getSourceMappings: jest.fn((name: string) =>
        name === ODELIA_LABELING_SOURCE_NAME
          ? [{ annotationType: 'ODELIALabel', toMeasurementSchema: (x: any) => x }]
          : []
      ),
      addRawMeasurement: jest.fn(() => 'uid-1'),
      getMeasurement: jest.fn(() => ({})),
      update: jest.fn(),
    };
    const extensionManager = { getActiveDataSource: jest.fn(() => [{ id: 'ds' }]) };
    const rows = [{ 'Patient ID': 'P1', StudyInstanceUID: 'S1', Ethnicity: 'A' }]; // no points
    expect(() =>
      importCSVReport({ measurementService, extensionManager } as any, rows)
    ).not.toThrow();
    expect(measurementService.clearMeasurements).toHaveBeenCalledTimes(1);
    expect(measurementService.addRawMeasurement).toHaveBeenCalledTimes(1); // the study label only
  });

  it('collates one label per StudyInstanceUID for a multi-study patient (LAB-M8)', () => {
    const { measurementService, extensionManager } = makeServices();
    const rows = [
      { 'Patient ID': 'P1', StudyInstanceUID: 'S1', Ethnicity: 'A' },
      { 'Patient ID': 'P1', StudyInstanceUID: 'S2', Ethnicity: 'B' },
    ];
    importCSVReport({ measurementService, extensionManager } as any, rows);
    expect(measurementService.clearMeasurements).toHaveBeenCalledTimes(1);
    // No 'points' columns => no lesion rows, so every add is a study-level label.
    const studyUIDs = measurementService.addRawMeasurement.mock.calls
      .map((c: any[]) => c[2].annotation.referenceStudyUID)
      .sort();
    expect(studyUIDs).toEqual(['S1', 'S2']);
  });
});
