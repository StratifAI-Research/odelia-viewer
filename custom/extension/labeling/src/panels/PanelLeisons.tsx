import React, { useEffect, useState } from 'react';
import PropTypes from 'prop-types';
import { utils, ServicesManager } from '@ohif/core';
import { MeasurementTable, Dialog, Input, useViewportGrid } from '@ohif/ui';
import ActionButtons from './ActionButtons';
import debounce from 'lodash.debounce';
import LabelingTable from '../../ui/LabelingTable';
import Config from "../utils/config";


const { downloadCSVReport } = utils;

export default function PanelLeisonTable({
  name,
  servicesManager,
  commandsManager,
  extensionManager,
}): React.FunctionComponent {
  const [viewportGrid, viewportGridService] = useViewportGrid();
  const { activeViewportIndex, viewports } = viewportGrid;
  const {
    measurementService,
    uiDialogService,
    uiNotificationService,
    displaySetService,
  } = (servicesManager as ServicesManager).services;
  const [displayMeasurements, setDisplayMeasurements] = useState([]);

  let total_config: Config = require('../utils/config.json');
  let config = total_config.panel_configs.filter(config => config.name == name)[0]

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

  async function exportReport() {
    const measurements = measurementService.getMeasurements();

    downloadCSVReport(measurements, measurementService);
  }

  async function clearMeasurements() {
    measurementService.clearMeasurements();
  }

  async function createReport(): Promise<any> {
    // filter measurements that are added to the active study
    const activeViewport = viewports[activeViewportIndex];
    const measurements = measurementService.getMeasurements();
    const displaySet = displaySetService.getDisplaySetByUID(
      activeViewport.displaySetInstanceUIDs[0]
    );
    const trackedMeasurements = measurements.filter(
      m => displaySet.StudyInstanceUID === m.referenceStudyUID
    );

    if (trackedMeasurements.length <= 0) {
      uiNotificationService.show({
        title: 'No Measurements',
        message: 'No Measurements are added to the current Study.',
        type: 'info',
        duration: 3000,
      });
      return;
    }

    const promptResult = await createReportDialogPrompt(uiDialogService, {
      extensionManager,
    });

    if (promptResult.action === CREATE_REPORT_DIALOG_RESPONSE.CREATE_REPORT) {
      const dataSources = extensionManager.getDataSources(
        promptResult.dataSourceName
      );
      const dataSource = dataSources[0];

      const SeriesDescription =
        // isUndefinedOrEmpty
        promptResult.value === undefined || promptResult.value === ''
          ? 'Research Derived Series' // default
          : promptResult.value; // provided value

      // Re-use an existing series having the same series description to avoid
      // creating too many series instances.
      const options = findSRWithSameSeriesDescription(
        SeriesDescription,
        displaySetService
      );

      return createReportAsync(
        servicesManager,
        commandsManager,
        dataSource,
        trackedMeasurements,
        options
      );
    }
  }

  const jumpToImage = ({ uid, isActive }) => {
    measurementService.jumpToMeasurement(viewportGrid.activeViewportIndex, uid);

    onMeasurementItemClickHandler({ uid, isActive });
  };

  const onMeasurementItemEditHandler = ({ uid, isActive }) => {
    const measurement = measurementService.getMeasurement(uid);
    //Todo: why we are jumping to image?
    // jumpToImage({ id, isActive });

    const onSubmitHandler = () => {
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
            measurement.label = "Leision annotated"
            measurementService.update(uid, measurement)
          };

          const onKeyPressHandler = event => {
            if (event.key === 'Enter') {
              onSubmitHandler({ value, action: { id: 'save' } });
            }
          };
          return (
            /*
            <div className="p-4 bg-primary-dark">
              <Input
                autoFocus
                id="annotation"
                className="mt-2 bg-black border-primary-main"
                type="text"
                containerClassName="mr-2"
                value={value.label}
                onChange={onChangeHandler}
                onKeyPress={onKeyPressHandler}
              />
            </div>
            */
            <div className="p-4 bg-primary-dark">
              <LabelingTable
                title='Leison annotation'
                measurement={measurement}
                config={config}
                onChange={onMeasurementItemEditHandler}
                onDelete={id => {
                }}
              />
            </div>
          );
        },
        actions: [
          // temp: swap button types until colors are updated
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
        <ActionButtons
          onExportClick={exportReport}
          onClearMeasurementsClick={clearMeasurements}
          onCreateReportClick={createReport}
        />
      </div>
    </>
  );
}

PanelLeisonTable.propTypes = {
  servicesManager: PropTypes.instanceOf(ServicesManager).isRequired,
};

function _getMappedMeasurements(measurementService) {
  const measurements = measurementService.getMeasurements();
  const filteredMeasurements = measurements.filter((element) => element.toolName != "ODELIALabel")

  const mappedMeasurements = filteredMeasurements.map((m, index) =>
    _mapMeasurementToDisplay(m, index, measurementService.VALUE_TYPES)
  );

  return mappedMeasurements;
}

/**
 * Map the measurements to the display text.
 * Adds finding and site inforamtion to the displayText and/or label,
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
  const label = baseLabel || finding?.text || firstSite?.text || 'Leison not annotated';
  let displayText = baseDisplayText || [];
  if (findingSites) {
    const siteText = [];
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
