import React from 'react';
import { MeasurementTable, useViewportGrid } from '@ohif/ui-next';
import ActionButtons from './ActionButtons';
import CSVImporter from './CSVImporter';

import LabelingTable from '../ui/LabelingTable';
import LesionAnnotationDialog from './LesionAnnotationDialog';
import Config from '../utils/config';
import configJson from '../utils/config.json';
import { getPanelConfig } from '../utils/panelConfig';
import { useMeasurementSubscription } from '../hooks/useMeasurementSubscription';

import downloadCSVReport from '../utils/downloadCSVReport';
import importCSVReport from '../utils/importCSVReport';

const ANNOTATION_DIALOG_ID = 'enter-annotation';

type PanelLesionTableProps = {
  name: string;
  servicesManager: AppTypes.ServicesManager;
  extensionManager: AppTypes.ExtensionManager;
  /** Passed by the panel module; unused by this panel. */
  commandsManager?: AppTypes.CommandsManager;
};

export default function PanelLesionTable({
  name,
  servicesManager,
  extensionManager,
}: PanelLesionTableProps) {
  const [{ activeViewportId }] = useViewportGrid();
  // AppTypes marks every service optional (a service can be left unregistered),
  // but both of these are core services the viewer always registers.
  const { measurementService, uiDialogService } = servicesManager.services as {
    measurementService: AppTypes.MeasurementService;
    uiDialogService: AppTypes.UIDialogService;
  };
  const [displayMeasurements, setDisplayMeasurements] = useMeasurementSubscription(
    measurementService,
    _getMappedMeasurements
  );

  const config = getPanelConfig(configJson as Config, name);

  function exportReport() {
    downloadCSVReport(measurementService.getMeasurements());
  }

  const selectMeasurement = (uid: string) => {
    setDisplayMeasurements(current =>
      current.map(measurement => ({ ...measurement, isSelected: measurement.uid === uid }))
    );
  };

  const jumpToMeasurement = (uid: string) => {
    if (activeViewportId) {
      measurementService.jumpToMeasurement(activeViewportId, uid);
    }
    selectMeasurement(uid);
  };

  const editMeasurement = (uid: string) => {
    const measurement = measurementService.getMeasurement(uid);

    const onLabelChange = (measurementUID: string, label: string, labelValue: string) => {
      const current = measurementService.getMeasurement(measurementUID);
      current.label_data[label] = labelValue;
      current.label = 'Lesion annotated';
      measurementService.update(measurementUID, current);
    };

    uiDialogService.show({
      id: ANNOTATION_DIALOG_ID,
      title: 'Enter your annotation',
      shouldCloseOnEsc: true,
      content: LesionAnnotationDialog,
      contentProps: {
        onDelete: () => measurementService.remove(uid),
        children: (
          <LabelingTable
            title="Lesion annotation"
            measurement={measurement}
            config={config}
            onChange={onLabelChange}
          />
        ),
      },
    });
  };

  // MeasurementTable emits the same command names the cornerstone extension
  // registers (see MeasurementTableNested); this panel handles the subset that
  // applies to ODELIA lesions and ignores the rest.
  const onAction = (_e: unknown, command: string | string[], uid: string) => {
    switch (command) {
      case 'jumpToMeasurement':
        jumpToMeasurement(uid);
        break;
      case 'renameMeasurement':
        editMeasurement(uid);
        break;
      case 'removeMeasurement':
        measurementService.remove(uid);
        break;
      default:
        break;
    }
  };

  return (
    <>
      <div
        className="ohif-scrollbar overflow-y-auto overflow-x-hidden"
        data-cy="measurements-panel"
      >
        <MeasurementTable
          title={name}
          data={displayMeasurements}
          onAction={onAction}
          isExpanded={true}
        >
          <MeasurementTable.Body />
        </MeasurementTable>
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
    </>
  );
}

function _getMappedMeasurements(measurementService) {
  return measurementService
    .getMeasurements()
    .filter(element => element.toolName !== 'ODELIALabel')
    .map(_mapMeasurementToDisplay);
}

/**
 * Project a measurement onto the row shape `MeasurementTable` renders.
 *
 * The finding/site text is folded into the label (falling back through
 * finding -> first finding site -> a placeholder) and `displayText` is left
 * empty on purpose: the site/finding text was computed in the pre-3.13 version
 * of this mapper and then unconditionally discarded, so keeping it empty
 * preserves the shipped behavior rather than newly surfacing that text.
 */
function _mapMeasurementToDisplay(measurement) {
  const { uid, label: baseLabel, type, selected, findingSites, finding } = measurement;

  const firstSite = findingSites?.[0];
  const label = baseLabel || finding?.text || firstSite?.text || 'Lesion not annotated';

  return {
    ...measurement,
    uid,
    label,
    baseLabel,
    measurementType: type,
    displayText: { primary: [], secondary: [] },
    isSelected: !!selected,
    finding,
    findingSites,
  };
}
