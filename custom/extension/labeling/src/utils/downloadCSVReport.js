import { DicomMetadataStore } from '@ohif/core';

export default function downloadCSVReport(measurementData) {
  if (measurementData.length === 0) {
    // Prevent download of report with no measurements.
    return;
  }

  const columns = ['Patient ID', 'Patient Name', 'StudyInstanceUID'];

  const reportMap = {};
  const labelMeasurements = measurementData.filter(
    measurement => measurement.type == 'ODELIALabel'
  );
  const leisonMeasurements = measurementData.filter(
    measurement => measurement.type == 'value_type::circle'
  );
  labelMeasurements.forEach(measurement => {
    const {
      referenceStudyUID,
      referenceSeriesUID,
      getReport,
      uid,
      type,
    } = measurement;

    //if (type != "ODELIALabel") {
    //  console.warn('Skipping leisons for now');
    //  return;
    //}
    if (!getReport) {
      console.warn('Measurement does not have a getReport function');
      return;
    }
    console.log(referenceStudyUID);
    console.log(measurement);
    const studyMetadata = DicomMetadataStore.getStudy(referenceStudyUID);
    const seriesMetadata = DicomMetadataStore.getSeries(
      referenceStudyUID,
      studyMetadata.series[0].SeriesInstanceUID
    );

    const commonRowItems = _getCommonRowItems(measurement, seriesMetadata);
    const report = getReport(measurement);

    //Filter leisions same as current study AND that has been annotated
    const filteredLeisions = leisonMeasurements
      .filter(measurement => measurement.referenceStudyUID == referenceStudyUID)
      .filter(measurement => measurement.label_data !== undefined);

    // Duplicate ODELIA label for each leision and add leision report, otherwise return ODELIALAbel
    if (filteredLeisions.length != 0) {
      filteredLeisions.forEach(leisonMeasurement => {
        const { getReport, uid, metadata } = leisonMeasurement;

        const leisionReport = getReport(leisonMeasurement);

        // TODO: Replace with proper getReport function for lesions
        Object.keys(leisonMeasurement.label_data).forEach(key => {
          leisionReport.columns.push(key);
          leisionReport.values.push(leisonMeasurement.label_data[key]);
        });

        leisionReport.columns = [...report.columns, ...leisionReport.columns];
        leisionReport.values = [...report.values, ...leisionReport.values];
        leisionReport.columns.push('referencedImageId');
        leisionReport.values.push(metadata['referencedImageId']);
        reportMap[uid] = {
          report: leisionReport,
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
  console.log(reportMap);
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

  let csvContent =
    'data:text/csv;charset=utf-8,' +
    results.map(row => row.map(_escapeCsvValue).join(',')).join('\n');

  _createAndDownloadFile(csvContent);
}

// Escape a single CSV cell. Prevents two classes of problems:
// 1. Structural corruption — values containing a comma, double-quote, CR or LF
//    are wrapped in quotes with embedded quotes doubled (RFC 4180).
// 2. Formula injection — a leading =, +, -, @, tab or CR lets a spreadsheet
//    interpret the cell as a formula, so it is prefixed with a single quote.
// `Array.prototype.map` preserves holes in the sparse row arrays, so empty
// columns still render as empty fields and column alignment is kept.
function _escapeCsvValue(value) {
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
    const row = [];
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

function _getCommonRowItems(measurement, seriesMetadata) {
  const firstInstance = seriesMetadata.instances[0];

  return {
    'Patient ID': firstInstance.PatientID, // Patient ID
    'Patient Name': firstInstance.PatientName.Alphabetic, // PatientName
    StudyInstanceUID: measurement.referenceStudyUID, // StudyInstanceUID
    Label: measurement.label || '', // Label
  };
}

function _createAndDownloadFile(csvContent) {
  const encodedUri = encodeURI(csvContent);

  const link = document.createElement('a');
  link.setAttribute('href', encodedUri);
  link.setAttribute('download', 'MeasurementReport.csv');
  document.body.appendChild(link);
  link.click();
}
