import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { ServicesManager } from '@ohif/core';
import { MeasurementTable, Dialog, Input, useViewportGrid } from '@ohif/ui';
import ActionButtons from './ActionButtons';
import CSVImporter from './CSVImporter'

import debounce from 'lodash.debounce';
import LabelingTable from '../ui/LabelingTable';
import Config from "../utils/config";
import { getPanelConfig } from '../utils/panelConfig';


import downloadCSVReport from '../utils/downloadCSVReport';
import importCSVReport from '../utils/importCSVReport';

export default function PanelLesionTable({
  name,
  servicesManager,
  commandsManager,
  extensionManager,
}) {
  const [viewportGrid, viewportGridService] = useViewportGrid();
  const { activeViewportIndex, viewports } = viewportGrid;
  const {
    measurementService,
    uiDialogService,
    uiNotificationService,
    displaySetService,
  } = (servicesManager as any).services;
  const [displayMeasurements, setDisplayMeasurements] = useState<any[]>([]);

  let totalConfig: Config = require('../utils/config.json');
  let config = getPanelConfig(totalConfig, name)

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
    const subscriptions: any[] = [];

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

  async function exportReport() {
    const measurements = measurementService.getMeasurements();
    downloadCSVReport(measurements);
  }

  async function clearMeasurements() {
    measurementService.clearMeasurements();
  }

  const jumpToImage = ({ uid, isActive }) => {
    measurementService.jumpToMeasurement(viewportGrid.activeViewportIndex, uid);

    onMeasurementItemClickHandler({ uid, isActive });
  };

  const onMeasurementItemEditHandler = ({ uid, isActive }) => {
    const measurement = measurementService.getMeasurement(uid);
    //Todo: why we are jumping to image?
    // jumpToImage({ id, isActive });

    // Defaulted so the Enter-key handler can call this with no args without
    // crashing on `action.id` (previously threw); Enter then just dismisses.
    const onSubmitHandler = ({ action }: { action?: any } = {}) => {
      switch (action?.id) {
        case 'delete': {
          measurementService.remove(uid)
        }
      }
      uiDialogService.dismiss({ id: 'enter-annotation' });
    };

    uiDialogService.create({
      id: 'enter-annotation',
      centralize: true,
      isDraggable: false,
      showOverlay: true,
      content: Dialog,
      contentProps: {
        title: 'Enter your annotation',
        noCloseButton: true,
        body: ({ value, setValue }) => {
          const onMeasurementItemEditHandler = (uid, label, label_value) => {
            const measurement = measurementService.getMeasurement(uid);
            measurement.label_data[label] = label_value
            console.log(measurement.label)
            measurement.label = "Lesion annotated"
            measurementService.update(uid, measurement)
          };

          const onKeyPressHandler = event => {
            if (event.key === 'Enter') {
              onSubmitHandler();
            }
          };
          return (
            <div className="p-4 bg-primary-dark">
              <LabelingTable
                title='Lesion annotation'
                measurement={measurement}
                config={config}
                onChange={onMeasurementItemEditHandler}
              />
            </div>
          );
        },
        actions: [
          // temp: swap button types until colors are updated
          { id: 'delete', text: 'Delete', type: 'cancel' },
          { id: 'save', text: 'Save', type: 'secondary' },
        ],
        onSubmit: onSubmitHandler,
      },
    });
  };

  const onMeasurementItemClickHandler = ({ uid, isActive }) => {
    if (!isActive) {
      const measurements = [...displayMeasurements];
      const measurement = measurements.find(m => m.uid === uid);

      measurements.forEach(m => (m.isActive = m.uid !== uid ? false : true));
      measurement.isActive = true;
      setDisplayMeasurements(measurements);
    }
  };

  return (
    <>
      <div
        className="overflow-x-hidden overflow-y-auto ohif-scrollbar"
        data-cy={'measurements-panel'}
      >
        <MeasurementTable
          title={name}
          servicesManager={servicesManager}
          data={displayMeasurements}
          onClick={jumpToImage}
          onEdit={onMeasurementItemEditHandler}
        />
      </div>
      <div className="flex justify-center p-4">
        <CSVImporter
          onClick={(csvData) => {
            importCSVReport({ measurementService, extensionManager }, csvData)
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

PanelLesionTable.propTypes = {
  servicesManager: PropTypes.instanceOf(ServicesManager).isRequired,
};

function _getMappedMeasurements(measurementService) {
  const measurements = measurementService.getMeasurements();
  const filteredMeasurements = measurements.filter((element) => element.toolName !== "ODELIALabel")

  const mappedMeasurements = filteredMeasurements.map((m, index) =>
    _mapMeasurementToDisplay(m, index, measurementService.VALUE_TYPES)
  );

  return mappedMeasurements;
}

/**
 * Map the measurements to the display text.
 * Adds finding and site information to the displayText and/or label,
 * and provides as 'displayText' and 'label', while providing the original
 * values as baseDisplayText and baseLabel
 */
function _mapMeasurementToDisplay(measurement, index, types) {
  const {
    displayText: baseDisplayText,
    uid,
    label: baseLabel,
    type,
    selected,
    findingSites,
    finding,
  } = measurement;

  const firstSite = findingSites?.[0];
  const label = baseLabel || finding?.text || firstSite?.text || 'Lesion not annotated';
  let displayText = baseDisplayText || [];
  if (findingSites) {
    const siteText: any[] = [];
    findingSites.forEach(site => {
      if (site?.text !== label) siteText.push(site.text);
    });
    displayText = [...siteText, ...displayText];
  }
  if (finding && finding?.text !== label) {
    displayText = [finding.text, ...displayText];
  }
  displayText = []
  return {
    uid,
    label,
    baseLabel,
    measurementType: type,
    displayText,
    baseDisplayText,
    isActive: selected,
    finding,
    findingSites,
  };
}
