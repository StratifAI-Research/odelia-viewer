import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import ActionButtons from './ActionButtons';
import CSVImporter from './CSVImporter';
import debounce from 'lodash.debounce';
import { useTranslation } from 'react-i18next';
import LabelingTable from '../../ui/LabelingTable';
import downloadCSVReport from '../utils/downloadCSVReport';
import importCSVReport from '../utils/importCSVReport';
import Config from '../utils/config';

export default function PanelLabeling({
  name,
  servicesManager,
  commandsManager,
  extensionManager,
}) {
  const { measurementService, uiDialogService } = servicesManager.services;

  let total_config: Config = require('../utils/config.json');
  let config = total_config.panel_configs.filter(
    config => config.name == name
  )[0];
  const { t } = useTranslation('PanelLabeling');
  const [displayMeasurements, setDisplayMeasurements] = useState([]);

  useEffect(() => {
    const debouncedSetDisplayMeasurements = debounce(
      setDisplayMeasurements,
      100
    );
    // ~~ Initial

    setDisplayMeasurements(_getMappedMeasurements(measurementService));

    // ~~ Subscription
    const added = measurementService.EVENTS.MEASUREMENT_ADDED;
    const addedRaw = measurementService.EVENTS.RAW_MEASUREMENT_ADDED;
    const updated = measurementService.EVENTS.MEASUREMENT_UPDATED;
    const removed = measurementService.EVENTS.MEASUREMENT_REMOVED;
    const cleared = measurementService.EVENTS.MEASUREMENTS_CLEARED;
    const subscriptions = [];

    [added, addedRaw, updated, removed, cleared].forEach(evt => {
      subscriptions.push(
        measurementService.subscribe(evt, () => {
          debouncedSetDisplayMeasurements(
            _getMappedMeasurements(measurementService)
          );
        }).unsubscribe
      );
    });

    return () => {
      subscriptions.forEach(unsub => {
        unsub();
      });
      debouncedSetDisplayMeasurements.cancel();
    };
  }, []);

  function _getMappedMeasurements(measurementService) {
    const measurements = measurementService.getMeasurements();
    const filteredMeasurements = measurements.filter(
      element => element.toolName == 'ODELIALabel'
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
    console.log(measurement.label_data[label]);
    measurementService.update(uid, measurement);
  };

  return (
    <div className="flex flex-col">
      <div className="overflow-x-hidden overflow-y-auto invisible-scrollbar">
        {/* show labeling table */}
        <div className="mt-4">
          {!!displayMeasurements.length &&
            displayMeasurements.map(measurement => {
              return (
                <LabelingTable
                  title={t('Labels')}
                  measurement={measurement}
                  config={config}
                  onClick={id => {}}
                  onToggleVisibility={id => {}}
                  onToggleVisibilityAll={ids => {
                    ids.map(id => {});
                  }}
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
