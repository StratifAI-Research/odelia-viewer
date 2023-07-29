import { id } from './id';
import toolbarButtons from './toolbarButtons.js';
import { DicomMetadataStore } from '@ohif/core';
import getStudies from './studiesList';

const configs = {
  Length: {},
  //
};


const ohif = {
  layout: '@ohif/extension-default.layoutTemplateModule.viewerLayout',
  sopClassHandler: '@ohif/extension-default.sopClassHandlerModule.stack',
  hangingProtocol: '@ohif/extension-default.hangingProtocolModule.default',
  leftPanel: '@ohif/extension-default.panelModule.seriesList',
  rightPanel: '@ohif/extension-default.panelModule.measure',
};

const labeling = {
  patientPanel: 'labeling.panelModule.panelLabeling',
  studyPanel: 'labeling.panelModule.panelLabelingStudy',
  leisonPanel: 'labeling.panelModule.panelLabelingLeison',
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
  "labeling": "^0.0.1"
};

function modeFactory({ modeConfiguration }) {
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
      const { toolbarService, toolGroupService } = servicesManager.services;
      const utilityModule = extensionManager.getModuleEntry(
        '@ohif/extension-cornerstone.utilityModule.tools'
      );

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
          { toolName: toolNames.StackScrollMouseWheel, bindings: [] },
        ],
        passive: [
          { toolName: toolNames.Length },
          { toolName: toolNames.Bidirectional },
          { toolName: toolNames.Probe },
          { toolName: toolNames.EllipticalROI },
          { toolName: toolNames.CircleROI },
          { toolName: toolNames.RectangleROI },
          { toolName: toolNames.StackScroll },
          { toolName: toolNames.CalibrationLine },
        ],
        // enabled
        // disabled
      };

      const toolGroupId = 'default';
      toolGroupService.createToolGroupAndAddTools(toolGroupId, tools, configs);

      let unsubscribe;

      const activateTool = () => {
        toolbarService.recordInteraction({
          groupId: 'WindowLevel',
          itemId: 'WindowLevel',
          interactionType: 'tool',
          commands: [
            {
              commandName: 'setToolActive',
              commandOptions: {
                toolName: 'WindowLevel',
              },
              context: 'CORNERSTONE',
            },
          ],
        });

        // We don't need to reset the active tool whenever a viewport is getting
        // added to the toolGroup.
        unsubscribe();
      };

      // Since we only have one viewport for the basic cs3d mode and it has
      // only one hanging protocol, we can just use the first viewport
      ({ unsubscribe } = toolGroupService.subscribe(
        toolGroupService.EVENTS.VIEWPORT_ADDED,
        activateTool
      ));

      toolbarService.init(extensionManager);
      toolbarService.addButtons(toolbarButtons);
      toolbarService.createButtonSection('primary', [
        'MeasurementTools',
        'Zoom',
        'WindowLevel',
        'Pan',
        'Layout',
        'MoreTools',
      ]);
    },
    onModeExit: ({ servicesManager }) => {
      const { toolGroupService, measurementService, toolbarService } =
        servicesManager.services;

      toolGroupService.destroy();
    },    /** */
    validationTags: {
      study: [],
      series: [],
    },
    /**
     * A boolean return value that indicates whether the mode is valid for the
     * modalities of the selected studies. For instance a PET/CT mode should be
     */
    isValidMode: ({ modalities }) => true,
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
          const {
            displaySetService,
            hangingProtocolService,
            measurementService
          } = servicesManager.services;

          const unsubscriptions = [];
          const initLabels = extensionManager.getModuleEntry(
            "labeling.utilityModule.initLabels"
          ).exports;
          //initLabels({ extensionManager, measurementService, StudyInstanceUID: 123 });
          initLabels({ extensionManager, measurementService, StudyInstanceUID: studyInstanceUIDs[0] });

          const onDisplaySetsAdded = ({ displaySetsAdded, options }) => {
            const displaySet = displaySetsAdded[0];
            const { StudyInstanceUID } = displaySet;
            //TODO: Fetch measurements from DICOM

            //measurementService.addMeasurement(/**...**/);
          };

          // subscription to the DISPLAY_SETS_ADDED
          const { unsubscribe: displaySetsAddedUnsubscribe } = displaySetService.subscribe(
            displaySetService.EVENTS.DISPLAY_SETS_ADDED,
            onDisplaySetsAdded
          );
          unsubscriptions.push(displaySetsAddedUnsubscribe);

          const {
            unsubscribe: instanceAddedUnsubscribe,
          } = DicomMetadataStore.subscribe(
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
            hangingProtocolService.run(
              { studies, activeStudy, displaySets },
              hangingProtocolId
            );
          });

          return unsubscriptions;
        },
        layoutTemplate: ({ location, servicesManager }) => {
          return {
            id: ohif.layout,
            props: {
              leftPanels: [ohif.leftPanel],
              rightPanels: [labeling.patientPanel, labeling.studyPanel, labeling.leisonPanel],
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
    /** List of extensions that are used by the mode */
    extensions: extensionDependencies,
    /** HangingProtocol used by the mode */
    // hangingProtocol: [''],
    /** SopClassHandlers used by the mode */
    sopClassHandlers: [ohif.sopClassHandler],
    /** hotkeys for mode */
    hotkeys: [''],
  };
}

const mode = {
  id,
  modeFactory,
  extensionDependencies,
};

export default mode;
