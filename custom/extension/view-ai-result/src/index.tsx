import React, { useMemo } from 'react';
import { id } from './id';
import AITrackedViewport from './components/AITrackedViewport';
import DisclaimerBanner from './components/DisclaimerBanner';
import HeatmapToggleAction from './components/HeatmapToggleAction';
import getPanelModule from './getPanelModule';
import getCustomizationModule from './getCustomizationModule';
import getHangingProtocolModule from './getHangingProtocolModule';
import { AIResultsService } from './services/AIResultsService';
import { ChatService } from './services/ChatService';
import { registerIcons } from './icons';
import createHeatmapImageSliceSynchronizer from './utils/createHeatmapImageSliceSynchronizer';
import {
  toggleHeatmapImageSliceSync,
  ensureHeatmapImageSliceSync,
  resetHeatmapSyncPreference,
} from './utils/toggleHeatmapImageSliceSync';

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
  preRegistration: ({ servicesManager }) => {
    // Register atomically and fail fast. A partially-registered extension
    // (e.g. aiResultsService present but the heatmap synchronizer missing) only
    // surfaces much later as confusing "missing behaviour"; rethrow a descriptive
    // startup error instead of swallowing it.
    try {
      // Before any panel renders, so the rail never falls back to "Missing Icon".
      registerIcons();

      servicesManager.registerService({
        name: 'aiResultsService',
        create: () => new AIResultsService(servicesManager.services?.uiNotificationService),
      });

      // Register custom heatmap synchronizer type
      const { syncGroupService } = servicesManager.services;
      syncGroupService.addSynchronizerType(
        'heatmapImageSlice',
        createHeatmapImageSliceSynchronizer
      );

      // Register ChatService for AI Chat panel
      servicesManager.registerService({
        name: 'chatService',
        create: () => new ChatService(),
      });
    } catch (error) {
      console.error('view-ai-result: extension registration failed:', error);
      throw new Error(
        `view-ai-result extension failed to register: ${(error as Error)?.message ?? error}`
      );
    }
  },

  /**
   * PanelModule should provide a list of panels that will be available in OHIF
   * for Modes to consume and render. Each panel is defined by a {name,
   * iconName, iconLabel, label, component} object. Example of a panel module
   * is the StudyBrowserPanel that is provided by the default extension in OHIF.
   */
  getPanelModule,

  /**
   * CustomizationModule exposes named customization blocks that a mode can opt
   * into by reference (see getCustomizationModule for the naming rule).
   */
  getCustomizationModule,

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
  getToolbarModule: ({ servicesManager }) => {
    return [
      {
        // Action-corner entry; a mode opts in by putting `aiHeatmapToggle`
        // into `viewportActionMenu.topRight`.
        name: 'viewAIResult.heatmapToggle',
        defaultComponent: HeatmapToggleAction,
      },
      {
        name: 'evaluate.heatmapSync',
        evaluate: () => {
          const { syncGroupService } = servicesManager.services;
          const synchronizer = syncGroupService.getSynchronizer('HEATMAP_IMAGE_SLICE_SYNC');
          // Use the public API instead of the private `_enabled` field.
          const isActive = synchronizer && !synchronizer.isDisabled();

          return {
            className: isActive ? 'text-primary' : '',
          };
        },
      },
    ];
  },
  /**
   * LayoutTemplateModule should provide a list of layout templates that will be
   * available in OHIF for Modes to consume and use to layout the viewer.
   * Each layout template is defined by a { name, id, component}. Examples include
   * the default layout template provided by the default extension which renders
   * a Header, left and right sidebars, and a viewport section in the middle
   * of the viewer.
   */
  getLayoutTemplateModule: ({ extensionManager }) => {
    function OdeliaViewerLayout(props) {
      const DefaultLayout = useMemo(() => {
        const entry = extensionManager.getModuleEntry(
          '@ohif/extension-default.layoutTemplateModule.viewerLayout'
        );
        return entry.component;
      }, []);

      // OHIF's own InvestigationalUseDialog would stack on top of the custom
      // DisclaimerBanner below. It is suppressed the supported way, via
      // `investigationalUseDialog: { option: 'never' }` in the app config, which
      // every ODELIA config sets — not by hiding its markup from here.
      return (
        <>
          <DefaultLayout {...props} />
          <DisclaimerBanner />
        </>
      );
    }

    return [
      {
        name: 'odeliaViewerLayout',
        id: 'odeliaViewerLayout',
        component: OdeliaViewerLayout,
      },
    ];
  },
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
  getCommandsModule: ({ servicesManager }) => {
    const actions = {
      // Returned, not awaited-and-dropped: the toolbar does not await commands, but handing
      // the promise back lets callers (and tests) wait for the initial alignment.
      toggleHeatmapImageSliceSync: () => toggleHeatmapImageSliceSync({ servicesManager }),
      // Exposed as commands so a mode can drive the automatic behaviour without importing
      // this extension's internals -- modes depend on extensions by module id, not package.
      ensureHeatmapImageSliceSync: () => ensureHeatmapImageSliceSync({ servicesManager }),
      resetHeatmapSyncPreference: () => resetHeatmapSyncPreference(),
    };

    const definitions = {
      toggleHeatmapImageSliceSync: {
        commandFn: actions.toggleHeatmapImageSliceSync,
        storeContexts: [],
        options: {},
      },
      ensureHeatmapImageSliceSync: {
        commandFn: actions.ensureHeatmapImageSliceSync,
        storeContexts: [],
        options: {},
      },
      resetHeatmapSyncPreference: {
        commandFn: actions.resetHeatmapSyncPreference,
        storeContexts: [],
        options: {},
      },
    };

    return {
      actions,
      definitions,
      defaultContext: 'CORNERSTONE',
    };
  },
};
