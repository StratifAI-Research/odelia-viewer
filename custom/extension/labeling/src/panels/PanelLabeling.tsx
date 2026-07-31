import React from 'react';
import ActionButtons from './ActionButtons';
import CSVImporter from './CSVImporter';
import { useTranslation } from 'react-i18next';
import LabelingTable from '../ui/LabelingTable';
import downloadCSVReport from '../utils/downloadCSVReport';
import importCSVReport from '../utils/importCSVReport';
import Config from '../utils/config';
import configJson from '../utils/config.json';
import { getPanelConfig } from '../utils/panelConfig';
import { useMeasurementSubscription } from '../hooks/useMeasurementSubscription';

type PanelLabelingProps = {
  name: string;
  servicesManager: AppTypes.ServicesManager;
  extensionManager: AppTypes.ExtensionManager;
  /** Passed by the panel module; unused by this panel. */
  commandsManager?: AppTypes.CommandsManager;
};

export default function PanelLabeling({
  name,
  servicesManager,
  extensionManager,
}: PanelLabelingProps) {
  // AppTypes marks every service optional (a service can be left unregistered),
  // but measurementService is a core service the viewer always registers.
  const { measurementService } = servicesManager.services as {
    measurementService: AppTypes.MeasurementService;
  };

  const config = getPanelConfig(configJson as Config, name);
  const { t } = useTranslation('PanelLabeling');
  const [displayMeasurements] = useMeasurementSubscription(
    measurementService,
    _getMappedMeasurements
  );

  function _getMappedMeasurements(service) {
    return service.getMeasurements().filter(element => element.toolName === 'ODELIALabel');
  }

  function exportReport() {
    downloadCSVReport(measurementService.getMeasurements());
  }

  const onMeasurementItemEditHandler = (uid: string, label: string, labelValue: string) => {
    const measurement = measurementService.getMeasurement(uid);
    measurement.label_data[label] = labelValue;

    measurementService.update(uid, measurement);
  };

  return (
    <div className="flex flex-col">
      <div className="invisible-scrollbar overflow-y-auto overflow-x-hidden">
        {/* show labeling table */}
        <div className="mt-4">
          {displayMeasurements.map((measurement, index) => (
            <LabelingTable
              key={measurement.uid ?? `measurement-${index}`}
              title={t('Labels')}
              measurement={measurement}
              config={config}
              onChange={onMeasurementItemEditHandler}
            />
          ))}
        </div>
        <div className="flex justify-center p-4">
          <CSVImporter
            onClick={csvData => {
              importCSVReport({ measurementService, extensionManager }, csvData);
            }}
          />
          <ActionButtons
            onClick={exportReport}
            name="Export CSV"
          />
        </div>
      </div>
    </div>
  );
}
