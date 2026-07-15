import { id } from './id';
import React from 'react';
import PanelLabeling from './panels/PanelLabeling';
import PanelLesionTable from './panels/PanelLesions';
import { initMeasurementService } from './initMeasurementService';
import initLabels from './initLabels';

export default {
  /**
   * Only required property. Should be a unique value across all extensions.
   */
  id,

  /**
   * Perform any pre-registration tasks here. This is called before the extension
   * is registered. Usually we run tasks such as: configuring the libraries
   * (e.g. cornerstone, cornerstoneTools, ...) or registering any services that
   * this extension is providing.
   */
  preRegistration: ({
    servicesManager,
    commandsManager,
    configuration = {},
  }) => {
    const { measurementService } = servicesManager.services;
    const ODELIAMeasurementSource = initMeasurementService(measurementService);

    // TODO: Hydrate labels
  },

  /**
   * PanelModule provides the labeling panels (patient / study / lesion tables)
   * that the labeling mode renders in the right sidebar.
   */
  getPanelModule: ({
    servicesManager,
    commandsManager,
    extensionManager,
  }): any[] => {
    const wrappedPanelLabeling = name => {
      return () => {
        return (
          <PanelLabeling
            name={name}
            commandsManager={commandsManager}
            servicesManager={servicesManager}
            extensionManager={extensionManager}
          />
        );
      };
    };
    const wrappedPanelLesions = name => {
      return () => {
        return (
          <PanelLesionTable
            name={name}
            commandsManager={commandsManager}
            servicesManager={servicesManager}
            extensionManager={extensionManager}
          />
        );
      };
    };

    return [
      {
        name: 'panelLabeling',
        iconName: 'tab-patient-info',
        iconLabel: 'Labeling',
        label: 'Patient label',
        component: wrappedPanelLabeling('patient table'),
      },
      {
        name: 'panelLabelingStudy',
        iconName: 'list-bullets',
        iconLabel: 'Study labels',
        label: 'Study labels',
        component: wrappedPanelLabeling('study table'),
      },
      {
        name: 'panelLabelingLesion',
        iconName: 'tool-circle',
        iconLabel: 'Lesion labels',
        label: 'Lesion labels',
        component: wrappedPanelLesions('lesion table'),
      },
    ];
  },

  getUtilityModule: ({ servicesManager }) => {
    return [
      {
        name: 'initLabels',
        exports: initLabels,
      },
    ];
  },
};
