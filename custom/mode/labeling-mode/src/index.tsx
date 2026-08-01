import { id } from './id';
import { DicomMetadataStore } from '@ohif/core';
import { registerModeToolbar } from '@ohif/mode-basic';
import getStudies from './studiesList';

const configs = {
  Length: {},
  //
};

const ohif = {
  layout: '@ohif/extension-default.layoutTemplateModule.viewerLayout',
  sopClassHandler: '@ohif/extension-default.sopClassHandlerModule.stack',
  leftPanel: '@ohif/extension-default.panelModule.seriesList',
};

const labeling = {
  patientPanel: 'labeling.panelModule.panelLabeling',
  studyPanel: 'labeling.panelModule.panelLabelingStudy',
  lesionPanel: 'labeling.panelModule.panelLabelingLesion',
};

const cornerstone = {
  viewport: '@ohif/extension-cornerstone.viewportModule.cornerstone',
};

/**
 * Just two dependencies to be able to render a viewport with panels in order
 * to make sure that the mode is working.
 */
const extensionDependencies = {
  '@ohif/extension-default': '^3.0.0',
  '@ohif/extension-cornerstone': '^3.0.0',
  labeling: '^0.0.1',
  'view-ai-result': '^0.0.1',
};

function modeFactory() {
  return {
    /**
     * Mode ID, which should be unique among modes used by the viewer. This ID
     * is used to identify the mode in the viewer's state.
     */
    id,
    routeName: 'odelia',
    /**
     * Mode name, which is displayed in the viewer's UI in the workList, for the
     * user to select the mode.
     */
    displayName: 'ODELIA Mode',
    /**
     * Runs when the Mode Route is mounted to the DOM. Usually used to initialize
     * Services and other resources.
     */

    onModeEnter: ({ servicesManager, extensionManager }) => {
      const { toolbarService, toolGroupService, customizationService } = servicesManager.services;

      // The mode route seeds this mode's `toolbarButtons` / `toolbarSections`
      // (see below) onto the Mode customization scope before this runs, and any
      // `?customization=` module layers on top, so reading them back here is what
      // lets the toolbar be extended without this mode restating it.
      registerModeToolbar(
        { toolbarService },
        {
          toolbarButtons: customizationService.getCustomization('toolbarButtons'),
          toolbarSections: customizationService.getCustomization('toolbarSections'),
        }
      );

      const utilityModule = extensionManager.getModuleEntry(
        '@ohif/extension-cornerstone.utilityModule.tools'
      );

      // Guard the module lookup (parity with send-ai) so a missing cornerstone
      // tools module degrades gracefully instead of throwing during mode entry.
      if (!utilityModule?.exports) {
        console.warn(
          'labeling-mode: Cornerstone tools utility module not found – tools not activated'
        );
        return;
      }

      const { toolNames, Enums } = utilityModule.exports;

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
          // StackScrollMouseWheel was folded into StackScroll upstream; the wheel
          // binding is what makes it scroll the stack.
          {
            toolName: toolNames.StackScroll,
            bindings: [{ mouseButton: Enums.MouseBindings.Wheel }],
          },
        ],
        passive: [
          { toolName: toolNames.Length },
          { toolName: toolNames.Bidirectional },
          { toolName: toolNames.Probe },
          { toolName: toolNames.EllipticalROI },
          { toolName: toolNames.CircleROI },
          { toolName: toolNames.RectangleROI },
          { toolName: toolNames.CalibrationLine },
        ],
        // enabled
        // disabled
      };

      const toolGroupId = 'default';
      toolGroupService.createToolGroupAndAddTools(toolGroupId, tools, configs);
    },
    onModeExit: ({ servicesManager }) => {
      const { toolGroupService } = servicesManager.services;

      toolGroupService.destroy();
    },
    validationTags: {
      study: [],
      series: [],
    },
    /**
     * Whether the mode is valid for the modalities of the selected studies.
     * Must return `{ valid, description? }` — WorkList destructures `.valid`,
     * so a bare boolean reads as `undefined` and disables the mode. This mode
     * accepts any study.
     */
    isValidMode: (_args?: { modalities?: string }) => ({ valid: true }),
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
        init: async (
          { servicesManager, extensionManager, studyInstanceUIDs, dataSource, filters },
          hangingProtocolId
        ) => {
          const { displaySetService, hangingProtocolService, measurementService } =
            servicesManager.services;

          const unsubscriptions: any[] = [];
          const initLabels = extensionManager.getModuleEntry(
            'labeling.utilityModule.initLabels'
          ).exports;
          // labeling-mode is an explicitly single-study workflow — only the
          // first requested study is initialized/labelled. Warn (rather than
          // silently label just one) if a multi-study route is opened, so the
          // incomplete-labelling limitation is visible.
          if (studyInstanceUIDs.length > 1) {
            console.warn(
              `labeling-mode: opened with ${studyInstanceUIDs.length} studies; only the first ` +
                `(${studyInstanceUIDs[0]}) is initialized for labelling.`
            );
          }
          initLabels({
            extensionManager,
            measurementService,
            StudyInstanceUID: studyInstanceUIDs[0],
          });

          const { unsubscribe: instanceAddedUnsubscribe } = DicomMetadataStore.subscribe(
            DicomMetadataStore.EVENTS.INSTANCES_ADDED,
            function ({ StudyInstanceUID, SeriesInstanceUID, madeInClient = false }) {
              const seriesMetadata = DicomMetadataStore.getSeries(
                StudyInstanceUID,
                SeriesInstanceUID
              );
              displaySetService.makeDisplaySets(seriesMetadata.instances, madeInClient);
            }
          );

          unsubscriptions.push(instanceAddedUnsubscribe);

          const allRetrieves = studyInstanceUIDs.map(StudyInstanceUID =>
            dataSource.retrieve.series.metadata({
              StudyInstanceUID,
              filters,
            })
          );

          Promise.allSettled(allRetrieves).then(() => {
            const displaySets = displaySetService.getActiveDisplaySets();

            if (!displaySets || !displaySets.length) {
              return;
            }

            // Gets the studies list to use
            const studies = getStudies(studyInstanceUIDs, displaySets);

            // study being displayed, and is thus the "active" study.
            const activeStudy = studies[0];

            // run the hanging protocol matching on the displaySets with the predefined
            // hanging protocol in the mode configuration
            hangingProtocolService.run({ studies, activeStudy, displaySets }, hangingProtocolId);
          });

          return unsubscriptions;
        },
        layoutTemplate: () => {
          return {
            id: ohif.layout,
            props: {
              leftPanels: [ohif.leftPanel],
              rightPanels: [labeling.patientPanel, labeling.studyPanel, labeling.lesionPanel],
              viewports: [
                {
                  namespace: cornerstone.viewport,
                  displaySetsToDisplay: [ohif.sopClassHandler],
                },
              ],
            },
          };
        },
      },
    ],
    /**
     * Toolbar composition. `{ $reference }` markers are expanded by the
     * customization service at read time, so this mode reuses the cornerstone
     * extension's button definitions instead of restating them, and only
     * overrides which buttons each section shows. Sections not listed here
     * (the viewport action menus, window-level menus, ...) keep upstream's.
     */
    toolbarButtons: [{ $reference: 'cornerstone.toolbarButtons' }],
    toolbarSections: [
      { $reference: 'cornerstone.toolbarSections' },
      {
        primary: ['MeasurementTools', 'Zoom', 'WindowLevel', 'Pan', 'Layout', 'MoreTools'],
        // Circle ROI is the lesion-marking tool this workflow uses; it was the
        // only measurement tool the pre-3.13 toolbar exposed.
        MeasurementTools: ['CircleROI'],
        MoreTools: [
          'Reset',
          'rotate-right',
          'flipHorizontal',
          'StackScroll',
          'invert',
          'CalibrationLine',
        ],
      },
    ],
    /** List of extensions that are used by the mode */
    extensions: extensionDependencies,
    /** HangingProtocol used by the mode */
    hangingProtocol: 'view-ai-result.hpSinglePrimary',
    /** SopClassHandlers used by the mode */
    sopClassHandlers: [ohif.sopClassHandler],
    /** hotkeys for mode */
    hotkeys: [],
  };
}

const mode = {
  id,
  modeFactory,
  extensionDependencies,
};

export default mode;
