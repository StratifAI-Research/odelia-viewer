import { DicomMetadataStore } from '@ohif/core';

export default function downloadCSVReport(measurementData) {
  if (measurementData.length === 0) {
    // Prevent download of report with no measurements.
    return;
  }

  const columns = ['Patient ID', 'Patient Name', 'StudyInstanceUID'];

  const reportMap = {};
  const labelMeasurements = measurementData.filter(
    measurement => measurement.type === 'ODELIALabel'
  );
  const lesionMeasurements = measurementData.filter(
    measurement => measurement.type === 'value_type::circle'
  );
  labelMeasurements.forEach(measurement => {
    const { referenceStudyUID, getReport, uid } = measurement;

    if (!getReport) {
      console.warn('Measurement does not have a getReport function');
      return;
    }

    // Guard against missing study/series/instance metadata (e.g. a label
    // imported for a study not present in the DicomMetadataStore): the row is
    // still emitted (with empty patient fields) rather than throwing on
    // `studyMetadata.series[0]`.
    const studyMetadata = DicomMetadataStore.getStudy(referenceStudyUID);
    const firstSeries = studyMetadata?.series?.[0];
    const seriesMetadata = firstSeries
      ? DicomMetadataStore.getSeries(referenceStudyUID, firstSeries.SeriesInstanceUID)
      : undefined;

    const commonRowItems = _getCommonRowItems(measurement, seriesMetadata);
    const report = getReport(measurement);

    //Filter lesions same as current study AND that has been annotated
    const filteredLesions = lesionMeasurements
      .filter(measurement => measurement.referenceStudyUID === referenceStudyUID)
      .filter(measurement => measurement.label_data !== undefined);

    // Duplicate ODELIA label for each lesion and add lesion report, otherwise return ODELIALabel
    if (filteredLesions.length !== 0) {
      filteredLesions.forEach(lesionMeasurement => {
        const { getReport, uid, metadata } = lesionMeasurement;

        const lesionReport = getReport(lesionMeasurement);

        // TODO: Replace with proper getReport function for lesions
        Object.keys(lesionMeasurement.label_data).forEach(key => {
          lesionReport.columns.push(key);
          lesionReport.values.push(lesionMeasurement.label_data[key]);
        });

        lesionReport.columns = [...report.columns, ...lesionReport.columns];
        lesionReport.values = [...report.values, ...lesionReport.values];
        lesionReport.columns.push('referencedImageId');
        lesionReport.values.push(metadata['referencedImageId']);
        reportMap[uid] = {
          report: lesionReport,
          commonRowItems,
        };
      });
    } else {
      reportMap[uid] = {
        report,
        commonRowItems,
      };
    }
  });

  // get columns names inside the report from each measurement and
  // add them to the rows array (this way we can add columns for any custom
  // measurements that may be added in the future)
  Object.keys(reportMap).forEach(id => {
    const { report } = reportMap[id];
    report.columns.forEach(column => {
      if (!columns.includes(column)) {
        columns.push(column);
      }
    });
  });

  const results = _mapReportsToRowArray(reportMap, columns);

  const csvContent = results
    .map(row => row.map(_escapeCsvValue).join(','))
    .join('\n');

  _createAndDownloadFile(csvContent);
}

// Escape a single CSV cell. Prevents two classes of problems:
// 1. Structural corruption — values containing a comma, double-quote, CR or LF
//    are wrapped in quotes with embedded quotes doubled (RFC 4180).
// 2. Formula injection — a leading =, +, -, @, tab or CR lets a spreadsheet
//    interpret the cell as a formula, so it is prefixed with a single quote.
// `Array.prototype.map` preserves holes in the sparse row arrays, so empty
// columns still render as empty fields and column alignment is kept.
export function _escapeCsvValue(value) {
  if (value === undefined || value === null) {
    return '';
  }

  let str = String(value);

  // Neutralize a leading =, +, -, @, tab or CR that a spreadsheet could execute
  // as a formula — but exempt plain numbers (e.g. "-12.5") so negative values
  // still round-trip for machine consumers.
  const isPlainNumber = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(str);
  if (!isPlainNumber && /^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }

  if (/[",\r\n]/.test(str)) {
    str = `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

function _mapReportsToRowArray(reportMap, columns) {
  const results = [columns];
  Object.keys(reportMap).forEach(id => {
    const { report, commonRowItems } = reportMap[id];
    const row: any[] = [];
    // For commonRowItems, find the correct index and add the value to the
    // correct row in the results array
    Object.keys(commonRowItems).forEach(key => {
      const index = columns.indexOf(key);
      const value = commonRowItems[key];
      row[index] = value;
    });

    // For each annotation data, find the correct index and add the value to the
    // correct row in the results array
    report.columns.forEach((column, index) => {
      const colIndex = columns.indexOf(column);
      const value = report.values[index];
      row[colIndex] = value;
    });

    results.push(row);
  });

  return results;
}

export function _getCommonRowItems(measurement, seriesMetadata) {
  const firstInstance = seriesMetadata?.instances?.[0];
  // PatientName may be a DICOM PN object ({ Alphabetic }) or a plain string.
  // Only fall back to PatientName itself when it is a string — a PN object with
  // no Alphabetic component (e.g. only Ideographic/Phonetic) must not be
  // stringified to "[object Object]" (it exported as an empty cell before).
  const patientName =
    firstInstance?.PatientName?.Alphabetic ??
    (typeof firstInstance?.PatientName === 'string' ? firstInstance.PatientName : '');

  return {
    'Patient ID': firstInstance?.PatientID ?? '', // Patient ID
    'Patient Name': patientName, // PatientName
    StudyInstanceUID: measurement.referenceStudyUID, // StudyInstanceUID
    Label: measurement.label || '', // Label
  };
}

export function _createAndDownloadFile(csvContent) {
  // Build a Blob + object URL rather than a `data:` URI. encodeURI() does not
  // escape '#', so any '#' in a patient name/ID or free-text label truncated the
  // file at the URL fragment; large exports also hit per-browser data: length
  // limits. A leading UTF-8 BOM keeps Excel from mis-decoding non-ASCII text.
  const blob = new Blob(['\uFEFF' + csvContent], {
    type: 'text/csv;charset=utf-8;',
  });
  const url = URL.createObjectURL(blob);

  const link = document.createElement('a');
  link.setAttribute('href', url);
  link.setAttribute('download', 'MeasurementReport.csv');
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
