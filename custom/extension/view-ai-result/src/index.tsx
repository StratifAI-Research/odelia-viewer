import React from 'react';
import { utils } from '@ohif/extension-cornerstone';
import { id } from './id.js';
import AITrackedViewport from './components/AITrackedViewport';
import getPanelModule from './getPanelModule';
import getHangingProtocolModule from './getHangingProtocolModule';
import { AIResultsService } from './services/AIResultsService';

/**
 * You can remove any of the following modules if you don't need them.
 */
export default {
  /**
   * Only required property. Should be a unique value across all extensions.
   * You ID can be anything you want, but it should be unique.
   */
  id,

  /**
   * Perform any pre-registration tasks here. This is called before the extension
   * is registered. Usually we run tasks such as: configuring the libraries
   * (e.g. cornerstone, cornerstoneTools, ...) or registering any services that
   * this extension is providing.
   */
  preRegistration: ({ servicesManager, commandsManager, configuration = {} }) => {
    console.log('🚀 AIResultsService preRegistration called');

    try {
      // Create service definition (matching orthanc-ai-routing pattern)
      const aiResultsServiceDefinition = {
        name: 'aiResultsService',
        create: ({ configuration = {} }) => {
          console.log('🔧 Creating AIResultsService instance');
          return new AIResultsService(servicesManager.services?.uiNotificationService);
        },
      };

      // Register the AIResultsService
      console.log('📝 Registering AIResultsService...');
      servicesManager.registerService(aiResultsServiceDefinition);
      console.log('✅ AIResultsService registered successfully');
    } catch (error) {
      console.error('❌ Error during AIResultsService registration:', error);
    }
  },

  /**
   * ServicesModule should provide a list of services that will be available in OHIF
   * for Modes to consume and use to manage data. Each service is defined by
   * an object of { name, type, create } where the name is the name of the service,
   * type is the type of service, and create is a function that creates the service.
   */
  getServicesModule: ({ servicesManager, commandsManager, extensionManager }) => {
    // Remove duplicate registration - service is already registered in preRegistration
    return [];
  },

  /**
   * PanelModule should provide a list of panels that will be available in OHIF
   * for Modes to consume and render. Each panel is defined by a {name,
   * iconName, iconLabel, label, component} object. Example of a panel module
   * is the StudyBrowserPanel that is provided by the default extension in OHIF.
   */
  getPanelModule,

  /**
   * ViewportModule should provide a list of viewports that will be available in OHIF
   * for Modes to consume and use in the viewports. Each viewport is defined by
   * {name, component} object. Example of a viewport module is the CornerstoneViewport
   * that is provided by the Cornerstone extension in OHIF.
   */
  getViewportModule: ({ servicesManager, commandsManager, extensionManager }) => {
    return [
      {
        name: 'ai-tracked-viewport',
        component: props => (
          <AITrackedViewport
            {...props}
            servicesManager={servicesManager}
            commandsManager={commandsManager}
            extensionManager={extensionManager}
          />
        ),
      },
    ];
  },

  /**
   * ToolbarModule should provide a list of tool buttons that will be available in OHIF
   * for Modes to consume and use in the toolbar. Each tool button is defined by
   * {name, defaultComponent, clickHandler }. Examples include radioGroupIcons and
   * splitButton toolButton that the default extension is providing.
   */
  getToolbarModule: ({ servicesManager, commandsManager, extensionManager }) => {},
  /**
   * LayoutTemplateMOdule should provide a list of layout templates that will be
   * available in OHIF for Modes to consume and use to layout the viewer.
   * Each layout template is defined by a { name, id, component}. Examples include
   * the default layout template provided by the default extension which renders
   * a Header, left and right sidebars, and a viewport section in the middle
   * of the viewer.
   */
  getLayoutTemplateModule: ({ servicesManager, commandsManager, extensionManager }) => {},
  /**
   * SopClassHandlerModule should provide a list of sop class handlers that will be
   * available in OHIF for Modes to consume and use to create displaySets from Series.
   * Each sop class handler is defined by a { name, sopClassUids, getDisplaySetsFromSeries}.
   * Examples include the default sop class handler provided by the default extension
   */
  getSopClassHandlerModule: ({ servicesManager, commandsManager, extensionManager }) => {},
  /**
   * HangingProtocolModule should provide a list of hanging protocols that will be
   * available in OHIF for Modes to use to decide on the structure of the viewports
   * and also the series that hung in the viewports. Each hanging protocol is defined by
   * { name, protocols}. Examples include the default hanging protocol provided by
   * the default extension that shows 2x2 viewports.
   */
  getHangingProtocolModule,
  /**
   * CommandsModule should provide a list of commands that will be available in OHIF
   * for Modes to consume and use in the viewports. Each command is defined by
   * an object of { actions, definitions, defaultContext } where actions is an
   * object of functions, definitions is an object of available commands, their
   * options, and defaultContext is the default context for the command to run against.
   */
  getCommandsModule: ({ servicesManager, commandsManager, extensionManager }) => {},
  /**
   * ContextModule should provide a list of context that will be available in OHIF
   * and will be provided to the Modes. A context is a state that is shared OHIF.
   * Context is defined by an object of { name, context, provider }. Examples include
   * the measurementTracking context provided by the measurementTracking extension.
   */
  getContextModule: ({ servicesManager, commandsManager, extensionManager }) => {},
  /**
   * DataSourceModule should provide a list of data sources to be used in OHIF.
   * DataSources can be used to map the external data formats to the OHIF's
   * native format. DataSources are defined by an object of { name, type, createDataSource }.
   */
  getDataSourcesModule: ({ servicesManager, commandsManager, extensionManager }) => {},
};
