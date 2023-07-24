import React, { useEffect, useState, useCallback, useReducer } from 'react';
import PropTypes from 'prop-types';
import classnames from 'classnames';
import ActionButtons from './ActionButtons';


import { useTranslation } from 'react-i18next';

import LabelingTable from '../../ui/LabelingTable';
import downloadCSVReport from '../utils/downloadCSVReport';
import DatePicker from "../../ui/DatePicker/DatePicker";
import Config from "../utils/config";
export default function PanelLabeling({
  name,
  servicesManager,
  commandsManager,
}) {
  const { measurementService, uiDialogService } = servicesManager.services;

  let total_config: Config = require('../utils/config.json');
  let config = total_config.panel_configs.filter(config => config.name == name)[0]
  const { t } = useTranslation('PanelLabeling');
  const [measurements, updateMeasurements] = useState(() =>
    measurementService.getMeasurements()
  );
  const filtered_measurement = measurements.filter(label =>
    label.type == "ODELIALabel"
  );


  async function exportReport() {
    const measurements = measurementService.getMeasurements();

    downloadCSVReport(measurements);
  }
  const onMeasurementItemEditHandler = (uid, label, label_value) => {
    const measurement = measurementService.getMeasurement(uid);
    measurement.label_data[label] = label_value
    console.log(measurement.label_data[label])
    measurementService.update(uid, measurement)
  }

  return (
    <div className="flex flex-col">

      <div className="overflow-x-hidden overflow-y-auto invisible-scrollbar">
        {/* show labeling table */}
        <div className="mt-4">
          {!!filtered_measurement.length &&
            filtered_measurement.map((measurement) => {

              return <LabelingTable
                title={t('Labels User 123')}
                measurement={measurement}
                config={config}
                onClick={id => {
                }}
                onToggleVisibility={id => {
                }}
                onToggleVisibilityAll={ids => {
                  ids.map(id => {
                  });
                }}
                onDelete={id => {
                }}
                onChange={
                  onMeasurementItemEditHandler
                }
              />
            })}
        </div>
        <div className="flex justify-center p-4">
          <ActionButtons
            onExportClick={exportReport}
          />
        </div>

      </div>
    </div >
  );
}

PanelLabeling.propTypes = {
  commandsManager: PropTypes.shape({
    runCommand: PropTypes.func.isRequired,
  })
};
