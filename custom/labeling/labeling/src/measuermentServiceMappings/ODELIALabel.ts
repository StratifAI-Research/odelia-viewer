const ODELIA_LABELING_SOURCE_NAME = 'OdeliaLabeleing';
const ODELIA_LABELING_SOURCE_VERSION = '0.1';

const ODELIALabel = {
  toAnnotation: measurement => { },

  /**
   * Maps form annotation event data to measurement service format.
   *
   * @param {Object} formEvent form data
   * @return {Measurement} Measurement instance
   */
  toMeasurement: (
    formEvent
  ) => {
    const { annotation } = formEvent;
    const { metadata, data, annotationUID } = annotation;
    const { StudyInstanceUID } = metadata
    if (!metadata || !data) {
      console.warn('ODELIALabel tool: Missing metadata or data');
      return null;
    }


    if (annotation.type != "ODELIALabel") {
      throw new Error('Wrong annotation type passed');
    }

    const displayText = getDisplayText(annotation.data);
    const getReport = () =>
      _getReport(annotation.data, StudyInstanceUID);

    return {
      uid: annotationUID,
      metadata,
      referenceStudyUID: StudyInstanceUID,
      label_data: data.label_data,
      toolName: annotation.type,
      displayText: displayText,
      type: annotation.type,
      getReport,
    };
  },
};

/*
This function is used to convert the measurement data to a format that is
suitable for the report generation (e.g. for the csv report). The report
returns a list of columns and corresponding values.
*/
function _getReport(data, StudyInstanceUID) {
  const columns: Array<string> = [];
  const values: Array<string> = [];

  // Add Type
  columns.push('AnnotationType');
  values.push('ODELIA:Label');
  Object.keys(data.label_data).forEach(key => {
    columns.push(key);
    values.push(data.label_data[key])
  }
  )
  return {
    columns,
    values,
  };
}

function getDisplayText(data) {

  return " ";
}

export { ODELIALabel, ODELIA_LABELING_SOURCE_NAME, ODELIA_LABELING_SOURCE_VERSION };
