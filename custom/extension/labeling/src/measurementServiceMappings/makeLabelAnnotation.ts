import { utils } from '@ohif/core';

export interface LabelAnnotationInput {
  /** The label_data map (label key -> value) stored on the measurement. */
  labelData: Record<string, any>;
  /** StudyInstanceUID the label belongs to. */
  referenceStudyUID: string;
  /** Provenance of the annotation, e.g. 'inited' or 'imported'. */
  source: string;
}

/**
 * Build an ODELIALabel raw-annotation object for
 * `MeasurementService.addRawMeasurement`. Shared by initLabels (source 'inited')
 * and importCSVReport (source 'imported').
 */
export function makeLabelAnnotation({
  labelData,
  referenceStudyUID,
  source,
}: LabelAnnotationInput) {
  return {
    annotationUID: utils.guid(),
    metadata: { source },
    data: { label_data: labelData },
    referenceStudyUID,
    toolName: 'ODELIALabel',
    displayText: 'displayText',
    type: 'ODELIALabel',
  };
}
