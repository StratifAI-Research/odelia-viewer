// import { initToolGroups, toolbarButtons } from '@ohif/mode-longitudinal';
import { id } from './id';
import { ModeFactoryParams } from './types';
import toolbarButtons from './toolbarButtons';

const ohif = {
  layout: '@ohif/extension-default.layoutTemplateModule.viewerLayout',
  sopClassHandler: '@ohif/extension-default.sopClassHandlerModule.stack',
  hangingProtocol: '@ohif/extension-default.hangingProtocolModule.default',
  leftPanel: 'view-ai-result.panelModule.seriesList',
  rightPanel: '@ohif/extension-cornerstone.panelModule.panelMeasurement',
};

const viewAIResult = {
  viewport: 'view-ai-result.viewportModule.ai-tracked-viewport',
};

// New Feedback Panel from view-ai-result extension
const viewAIResultPanel = {
  feedback: 'view-ai-result.panelModule.aiFeedback',
};

const orthancAI = {
  panel: 'orthanc-ai-routing.panelModule.ai-routing-panel',
};

/**
 * Dependencies for the mode including the orthanc-ai-routing extension
 */
const extensionDependencies = {
  '@ohif/extension-default': '^3.0.0',
  '@ohif/extension-cornerstone': '^3.0.0',
  'orthanc-ai-routing': '^0.0.1',
  'view-ai-result': '^0.0.1',
};

function modeFactory({ modeConfiguration }: { modeConfiguration: any }) {
  return {
    /**
     * Mode ID, which should be unique among modes used by the viewer. This ID
     * is used to identify the mode in the viewer's state.
     */
    id,
    routeName: 'template',
    /**
     * Mode name, which is displayed in the viewer's UI in the workList, for the
     * user to select the mode.
     */
    displayName: 'AI Analysis Mode',
    /**
     * Runs when the Mode Route is mounted to the DOM. Usually used to initialize
     * Services and other resources.
     */
    onModeEnter: ({ servicesManager, extensionManager }: ModeFactoryParams) => {
      const { measurementService, toolbarService, toolGroupService } = servicesManager.services;

      // Clear existing measurements
      measurementService?.clearMeasurements?.();

      // Enable nested AI sub-tabs by default
      const { customizationService } = servicesManager.services;
      customizationService?.setCustomizations?.({
        'studyBrowser.tabMode': 'study-ai-subtabs',
      });

      // Obtain Cornerstone tool definitions
      const utilityModule = extensionManager.getModuleEntry(
        '@ohif/extension-cornerstone.utilityModule.tools'
      );

      if (!utilityModule) {
        console.warn('Cornerstone tools utility module not found – browsing tools not activated');
        return;
      }

      const { toolNames, Enums } = utilityModule.exports;

      // Prepare default tool group with basic browsing tools
      const tools = {
        active: [
          {
            toolName: toolNames.WindowLevel,
            bindings: [{ mouseButton: Enums.MouseBindings.Primary }],
          },
          {
            toolName: toolNames.Pan,
            bindings: [{ mouseButton: Enums.MouseBindings.Auxiliary }],
          },
          {
            toolName: toolNames.Zoom,
            bindings: [{ mouseButton: Enums.MouseBindings.Secondary }],
          },
          {
            toolName: toolNames.StackScroll,
            bindings: [{ mouseButton: Enums.MouseBindings.Wheel }],
          },
        ],
        passive: [{ toolName: toolNames.StackScroll }],
        enabled: [],
      };

      // Create tool group if missing and add tools
      try {
        toolGroupService.createToolGroupAndAddTools('default', tools);
      } catch (err) {
        console.warn('Tool group already exists – skipping creation');
      }

      // Register toolbar buttons (safe to call multiple times – service de-dupes)
      toolbarService?.addButtons?.(toolbarButtons);

      // Ensure buttons appear in primary section
      toolbarService?.createButtonSection?.('primary', ['Zoom', 'WindowLevel', 'Pan', 'Reset', 'ImageSliceSync']);
    },
    onModeExit: ({ servicesManager }: ModeFactoryParams) => {
      const {
        toolGroupService,
        syncGroupService,
        segmentationService,
        cornerstoneViewportService,
        uiDialogService,
        uiModalService,
      } = servicesManager.services;

      uiDialogService.hideAll();
      uiModalService.hide();
      toolGroupService.destroy();
      syncGroupService.destroy();
      segmentationService.destroy();
      cornerstoneViewportService.destroy();
    },
    /** */
    validationTags: {
      study: [],
      series: [],
    },
    /**
     * A boolean return value that indicates whether the mode is valid for the
     * modalities of the selected studies. For instance a PET/CT mode should be
     */
    isValidMode: ({ modalities }) => {
      return { valid: true };
    },
    /**
     * Mode Routes are used to define the mode's behavior. A list of Mode Route
     * that includes the mode's path and the layout to be used. The layout will
     * include the components that are used in the layout. For instance, if the
     * default layoutTemplate is used (id: '@ohif/extension-default.layoutTemplateModule.viewerLayout')
     * it will include the leftPanels, rightPanels, and viewports. However, if
     * you define another layoutTemplate that includes a Footer for instance,
     * you should provide the Footer component here too. Note: We use Strings
     * to reference the component's ID as they are registered in the internal
     * ExtensionManager. The template for the string is:
     * `${extensionId}.{moduleType}.${componentId}`.
     */
    routes: [
      {
        path: 'template',
        layoutTemplate: ({ location, servicesManager }) => {
          return {
            id: ohif.layout,
            props: {
              leftPanels: [ohif.leftPanel],
              rightPanels: [orthancAI.panel, viewAIResultPanel.feedback],
              viewports: [
                {
                  namespace: viewAIResult.viewport,
                  displaySetsToDisplay: [ohif.sopClassHandler],
                },
              ],
              servicesManager,
              defaultContext: {
                servicesManager: true,
              },
            },
          };
        },
      },
    ],
    /** List of extensions that are used by the mode */
    extensions: extensionDependencies,
    /** HangingProtocol used by the mode */
    // hangingProtocol: [''],
    /** SopClassHandlers used by the mode */
    sopClassHandlers: [ohif.sopClassHandler],
    /** hotkeys for mode */
  };
}

const mode = {
  id,
  modeFactory,
  extensionDependencies,
};

export default mode;
