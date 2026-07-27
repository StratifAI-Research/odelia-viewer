import React from 'react';
import PropTypes from 'prop-types';
import ActionButtons from './ActionButtons';
import CSVImporter from './CSVImporter';
import { useTranslation } from 'react-i18next';
import LabelingTable from '../ui/LabelingTable';
import downloadCSVReport from '../utils/downloadCSVReport';
import importCSVReport from '../utils/importCSVReport';
import Config from '../utils/config';
import { getPanelConfig } from '../utils/panelConfig';
import { useMeasurementSubscription } from '../hooks/useMeasurementSubscription';

export default function PanelLabeling({
  name,
  servicesManager,
  commandsManager,
  extensionManager,
}) {
  const { measurementService, uiDialogService } = servicesManager.services;

  let totalConfig: Config = require('../utils/config.json');
  let config = getPanelConfig(totalConfig, name);
  const { t } = useTranslation('PanelLabeling');
  const [displayMeasurements] = useMeasurementSubscription(
    measurementService,
    _getMappedMeasurements
  );

  function _getMappedMeasurements(measurementService) {
    const measurements = measurementService.getMeasurements();
    const filteredMeasurements = measurements.filter(
      element => element.toolName === 'ODELIALabel'
    );
    return filteredMeasurements;
  }

  async function exportReport() {
    const measurements = measurementService.getMeasurements();

    downloadCSVReport(measurements);
  }

  const onMeasurementItemEditHandler = (uid, label, label_value) => {
    const measurement = measurementService.getMeasurement(uid);
    measurement.label_data[label] = label_value;

    measurementService.update(uid, measurement);
  };

  return (
    <div className="flex flex-col">
      <div className="overflow-x-hidden overflow-y-auto invisible-scrollbar">
        {/* show labeling table */}
        <div className="mt-4">
          {!!displayMeasurements.length &&
            displayMeasurements.map((measurement, index) => {
              return (
                <LabelingTable
                  key={measurement.uid ?? `measurement-${index}`}
                  title={t('Labels')}
                  measurement={measurement}
                  config={config}
                  onClick={() => {}}
                  onChange={onMeasurementItemEditHandler}
                />
              );
            })}
        </div>
        <div className="flex justify-center p-4">
          <CSVImporter
            onClick={csvData => {
              importCSVReport(
                { measurementService, extensionManager },
                csvData
              );
            }}
          />
          <ActionButtons onClick={exportReport} name="Export CSV" />
        </div>
      </div>
    </div>
  );
}

PanelLabeling.propTypes = {
  commandsManager: PropTypes.shape({
    runCommand: PropTypes.func.isRequired,
  }),
};
