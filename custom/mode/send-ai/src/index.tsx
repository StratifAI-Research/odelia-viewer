import { id } from './id';
import { registerModeToolbar } from '@ohif/mode-basic';
import { ModeFactoryParams } from './types';
import toolbarButtons from './toolbarButtons';

const ohif = {
  layout: 'view-ai-result.layoutTemplateModule.odeliaViewerLayout',
  sopClassHandler: '@ohif/extension-default.sopClassHandlerModule.stack',
  leftPanel: 'view-ai-result.panelModule.seriesList',
};

// AI results arrive as DICOM SR. Without these handlers the stack handler declines the
// SR (getSopClassHandlerModule skips a non-image instance with no Rows) and
// DisplaySetService falls back to getDisplaySetsFromUnsupportedSeries, which wraps the
// SR in an ImageSet. That fallback is actively harmful here:
//   - the ImageSet has a truthy `.images`, so DicomWebDataSource mints a
//     `/frames/1` wadors imageId for an object with no pixel data. The study prefetcher
//     then requests it, Orthanc answers 400, and the rejection surfaces as an
//     "Something went wrong" toast carrying a bare XMLHttpRequest (no message, no
//     stack), so the error dialog renders blank.
//   - it sets `instance: instances[instance.length - 1]`, i.e. `instances[NaN]` ===
//     undefined, so `displaySet.instance` is lost and extractAIResultData()'s
//     `displaySet.instance?.ContentSequence` guard silently returns null.
// A real SR display set has no `.images` and keeps `.instance`, which fixes both.
const dicomsr = {
  sopClassHandler: '@ohif/extension-cornerstone-dicom-sr.sopClassHandlerModule.dicom-sr',
  sopClassHandler3D: '@ohif/extension-cornerstone-dicom-sr.sopClassHandlerModule.dicom-sr-3d',
};

const viewAIResult = {
  viewport: 'view-ai-result.viewportModule.ai-tracked-viewport',
  hangingProtocol: 'view-ai-result.hpSinglePrimary',
};

// Panels from view-ai-result extension
const viewAIResultPanel = {
  feedback: 'view-ai-result.panelModule.aiFeedback',
  chat: 'view-ai-result.panelModule.aiChat',
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
  // Registered on mode entry via Mode.tsx's `loadModules(Object.keys(extensions))`, so
  // being `default: false` in pluginConfig.json does not keep it out of this mode.
  '@ohif/extension-cornerstone-dicom-sr': '^3.0.0',
  'orthanc-ai-routing': '^0.0.1',
  'view-ai-result': '^0.0.1',
};

/**
 * GRID_STATE_CHANGED subscriptions for the automatic heatmap slice sync, held outside
 * onModeEnter so onModeExit can drop them -- onModeExit destroys syncGroupService, and a
 * surviving subscription would re-arm sync against torn-down services.
 *
 * Keyed on servicesManager rather than a single module-level variable: with one variable, a
 * second viewer root in the same realm -- or this mode being re-entered while the previous
 * instance is still exiting -- would overwrite the stored subscription, after which the older
 * onModeExit would unsubscribe the NEWER viewer's subscription and leave its own alive. A
 * WeakMap keeps each viewer's subscription separate and lets it be collected with the viewer.
 */
const gridSubscriptions = new WeakMap<object, { unsubscribe: () => void }>();

function modeFactory() {
  return {
    /**
     * Mode ID, which should be unique among modes used by the viewer. This ID
     * is used to identify the mode in the viewer's state.
     */
    id,
    // Drives the launch URL (/{routeName}/...); the WorkList builds mode links from
    // this, so it stays self-consistent.
    routeName: 'send-ai',
    /**
     * Mode name, which is displayed in the viewer's UI in the workList, for the
     * user to select the mode.
     */
    displayName: 'AI Analysis Mode',
    /**
     * Runs when the Mode Route is mounted to the DOM. Usually used to initialize
     * Services and other resources.
     */
    onModeEnter: ({ servicesManager, extensionManager, commandsManager }: ModeFactoryParams) => {
      const { measurementService, toolbarService, toolGroupService } = servicesManager.services;

      // Clear existing measurements
      measurementService?.clearMeasurements?.();

      // Enable nested AI sub-tabs by default
      const { customizationService } = servicesManager.services;
      customizationService?.setCustomizations?.({
        'studyBrowser.tabMode': 'study-ai-subtabs',
      });

      // Replace the stock viewport overlay text with the AI summary. Mode
      // scope, so it is undone when the user leaves this mode.
      customizationService?.setCustomizations?.([
        'view-ai-result.customizationModule.aiViewportOverlay',
      ]);

      // The mode route seeds this mode's `toolbarButtons` / `toolbarSections`
      // (see below) onto the Mode customization scope before this runs, so
      // reading them back here picks up anything a `?customization=` module
      // layered on top.
      registerModeToolbar(
        { toolbarService },
        {
          toolbarButtons: customizationService.getCustomization('toolbarButtons'),
          toolbarSections: customizationService.getCustomization('toolbarSections'),
        }
      );

      // Append (updateSection appends to an existing section) rather than
      // restating cornerstone's topRight corner, so upstream's badges keep
      // working and this mode only adds the heatmap toggle.
      toolbarService.updateSection(toolbarService.sections.viewportActionMenu.topRight, [
        'aiHeatmapToggle',
      ]);

      // Link the viewports as soon as a heatmap opens beside its primary imaging, instead
      // of waiting for the reader to press the toggle. Subscribed rather than done once
      // here because the second viewport appears later, when a thumbnail is dragged in.
      //
      // Driven through commands rather than importing view-ai-result's helpers: a mode
      // depends on an extension by module id, and this one is not a package dependency of
      // send-ai. `ensureHeatmapImageSliceSync` is built for this call site -- it no-ops
      // unless a second viewport holds an AI result, every viewport is renderable, and sync
      // is off, so firing it on every grid change is cheap. The toolbar toggle stays
      // authoritative: switching sync off records that preference and this stops re-arming
      // it, which is what `resetHeatmapSyncPreference` clears on each entry.
      const { viewportGridService } = servicesManager.services;

      commandsManager.run('resetHeatmapSyncPreference');
      gridSubscriptions.get(servicesManager)?.unsubscribe();
      gridSubscriptions.set(
        servicesManager,
        viewportGridService.subscribe(viewportGridService.EVENTS.GRID_STATE_CHANGED, () => {
          Promise.resolve(commandsManager.run('ensureHeatmapImageSliceSync')).catch(
            (error: unknown) =>
              console.warn('send-ai: automatic heatmap slice sync failed', error)
          );
        })
      );

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

      // Create tool group if missing and add tools. The group may already exist
      // (benign on re-entry); log the actual error so a genuine tool/config
      // failure isn't hidden behind an "already exists" assumption.
      try {
        toolGroupService.createToolGroupAndAddTools('default', tools);
      } catch (err) {
        console.warn(
          'send-ai: createToolGroupAndAddTools failed (tool group may already exist):',
          err
        );
      }
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

      // Before the services below are destroyed: this subscription re-arms slice sync, and
      // it must not fire against a torn-down syncGroupService. Scoped to this viewer, so
      // tearing down one viewer cannot cancel another's.
      gridSubscriptions.get(servicesManager)?.unsubscribe();
      gridSubscriptions.delete(servicesManager);

      uiDialogService.hideAll();
      uiModalService.hide();
      toolGroupService.destroy();
      syncGroupService.destroy();
      segmentationService.destroy();
      cornerstoneViewportService.destroy();
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
    isValidMode: () => {
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
        layoutTemplate: ({ servicesManager }) => {
          return {
            id: ohif.layout,
            props: {
              leftPanels: [ohif.leftPanel],
              leftPanelResizable: true,
              rightPanels: [orthancAI.panel, viewAIResultPanel.feedback, viewAIResultPanel.chat],
              rightPanelResizable: true,
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
    /**
     * Toolbar composition. `{ $reference }` markers are expanded by the
     * customization service at read time, so the standard tool buttons come from
     * the cornerstone extension's pack and only this mode's own button is
     * defined locally. Sections not listed here (viewport action menus, ...)
     * keep upstream's contents.
     */
    toolbarButtons: [{ $reference: 'cornerstone.toolbarButtons' }, ...toolbarButtons],
    toolbarSections: [
      { $reference: 'cornerstone.toolbarSections' },
      { primary: ['Zoom', 'WindowLevel', 'Pan', 'Reset', 'HeatmapSliceSync'] },
    ],
    /** List of extensions that are used by the mode */
    extensions: extensionDependencies,
    /**
     * HangingProtocol used by the mode -- the same one labeling-mode pins.
     *
     * Without this, setActiveProtocolIds() nulls activeProtocolIds ("No active
     * protocols, setting all to active") and run() falls to ProtocolEngine matching,
     * where every registered protocol competes and the layout rests on hpSinglePrimary's
     * weight-100 rule out-scoring the rest. It does win for a single-study MR/SC/SR URL,
     * but two protocols already outscore it whenever their rules pass:
     * @ohif/hpCompare (weight 1000, requires a prior study, so any multi-study URL) and
     * @ohif/hpMammo (150, an MG study). So this is a live exposure, not a guard against
     * some future protocol.
     *
     * Naming it takes run()'s getProtocolById branch, which skips protocol matching
     * altogether -- also what quietens the "no matching rules - specify
     * protocolMatchingRules for default/mpr/..." warnings on entry (40 logs down to 8).
     *
     * Trade-off, shared with labeling-mode, which has always pinned this: forcing the
     * protocol also skips its own protocolMatchingRules. A study that fails
     * `numberOfDisplaySetsWithImages > 0` (SR-only, PDF/video-only) can no longer fall
     * through to another protocol and hangs a 1x1 EmptyViewport with no explanation.
     * `allowUnmatchedView: true` does not help -- it governs later drop/replace, not
     * initial matching. Acceptable here because this mode exists to show one study's
     * primary imaging alongside its AI result, and a study with no primary imaging has
     * nothing for it to do.
     */
    hangingProtocol: viewAIResult.hangingProtocol,
    /**
     * SopClassHandlers used by the mode. Order mirrors mode-basic: the stack handler
     * first, then SR with 3D ahead of 2D. DisplaySetService runs every handler in turn
     * and drops the instances each one claims, so the stack handler's position is not
     * load-bearing here (it declines the SR outright) -- but keeping upstream's relative
     * order avoids surprises if that changes.
     */
    sopClassHandlers: [ohif.sopClassHandler, dicomsr.sopClassHandler3D, dicomsr.sopClassHandler],
  };
}

const mode = {
  id,
  modeFactory,
  extensionDependencies,
};

export default mode;
