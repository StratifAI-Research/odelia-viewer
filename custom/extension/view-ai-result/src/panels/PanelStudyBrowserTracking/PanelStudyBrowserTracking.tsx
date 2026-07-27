import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import PropTypes from 'prop-types';
import { useSystem, utils } from '@ohif/core';
import { useImageViewer, Dialog, ButtonEnums } from '@ohif/ui';
import { useViewportGrid } from '@ohif/ui-next';
import { StudyBrowser } from '@ohif/ui-next';
import { StudyBrowserNested } from '../../components/StudyBrowserNested/StudyBrowserNested';
import { Separator } from '@ohif/ui-next';
import { PanelStudyBrowserHeader, MoreDropdownMenu } from '@ohif/extension-default';
import { defaultActionIcons } from './constants';
import { createAIBrowserTabs } from '../../utils/createAIBrowserTabs';
import { createStudyAIBrowserTabsNested } from '../../utils/createStudyAIBrowserTabsNested';
import { applyAIThumbnailStyles, setupAIThumbnailObserver } from '../../utils/applyAIThumbnailStyles';
import { useStudyChangeDetector } from '../../hooks/useStudyChangeDetector';
import {
  thumbnailNoImageModalities,
  mapDisplaySets,
  mapDataSourceStudies,
  getImageIdForThumbnail,
  findTabAndStudyOfDisplaySet,
} from './panelDisplaySetMapping';
import { isAIResultModality, resolveInitialSelectedSRUID } from './panelAISelection';

import '../../components/AIThumbnail.css';

const { formatDate } = utils;

// Add proper type definitions
type DisplaySet = {
  displaySetInstanceUID: string;
  modality?: string;
  Modality?: string;
  description?: string;
  seriesDescription?: string;
  StudyInstanceUID?: string;
  studyInstanceUID?: string;
  SeriesInstanceUID?: string;
  SeriesNumber?: number;
  numImageFrames?: number;
  countIcon?: string;
  instance?: any;
  SeriesDate?: string;
  StudyDate?: string;
  thumbnailSrc?: string;
  loadingProgress?: number;
  isTracked?: boolean;
  [key: string]: any;
};

type StudyDisplayItem = {
  studyInstanceUid: string;
  date: string;
  description: string;
  modalities: string[];
  numInstances: number;
};

const DIALOG_ID = {
  UNTRACK_SERIES: 'untrack-series',
  REJECT_REPORT: 'ds-reject-sr',
};

/**
 *
 * @param {*} param0
 */
export default function PanelStudyBrowserTracking({
  getImageSrc,
  getStudiesForPatientByMRN,
  requestDisplaySetCreationForStudy,
  dataSource,
}) {
  const { servicesManager, commandsManager } = useSystem();
  const {
    displaySetService,
    uiDialogService,
    hangingProtocolService,
    uiNotificationService,
    studyPrefetcherService,
    customizationService,
    uiModalService,
    aiResultsService,
  } = servicesManager.services;

  const navigate = useNavigate();
  const studyMode = customizationService.getCustomization('studyBrowser.studyMode');
  const tabMode = customizationService.getCustomization('studyBrowser.tabMode');

  /*

  */
  const { t } = useTranslation('Common');

  // Normally you nest the components so the tree isn't so deep, and the data
  // doesn't have to have such an intense shape. This works well enough for now.
  // Tabs --> Studies --> DisplaySets --> Thumbnails
  const { StudyInstanceUIDs } = useImageViewer();
  const [{ activeViewportId, viewports, isHangingProtocolLayout }, viewportGridService] =
    useViewportGrid();

  const [activeTabName, setActiveTabName] = useState(
    tabMode === 'study-ai-subtabs' ? 'all' : studyMode
  );
  const [expandedStudyInstanceUIDs, setExpandedStudyInstanceUIDs] = useState([
    ...StudyInstanceUIDs,
  ]);
  const [studyDisplayList, setStudyDisplayList] = useState<StudyDisplayItem[]>([]);
  const [hasLoadedViewports, setHasLoadedViewports] = useState(false);
  const [displaySets, setDisplaySets] = useState<DisplaySet[]>([]);
  const [displaySetsLoadingState, setDisplaySetsLoadingState] = useState({});
  const [thumbnailImageSrcMap, setThumbnailImageSrcMap] = useState({});
  const [jumpToDisplaySet, setJumpToDisplaySet] = useState(null);

  // Track globally-selected AI SR UID published by the AIResultsService
  const [selectedSRUID, setSelectedSRUID] = useState<string | null>(null);
  const selectedSRUIDRef = useRef<string | null>(null);

  // Keep ref in sync so subscription callback always has latest value
  useEffect(() => {
    selectedSRUIDRef.current = selectedSRUID;
  }, [selectedSRUID]);

  // Cache for thumbnail props to prevent constant recalculation of static data like dates
  const [thumbnailPropsCache] = useState(new Map());

  // Refs mirror mutable state so the AI-selection subscription below can read
  // the latest values without listing them as effect deps. Otherwise every
  // loading/thumbnail tick tore down and re-created the subscription and re-ran
  // the initial-selection loop (VAR-M5).
  const displaySetsLoadingStateRef = useRef(displaySetsLoadingState);
  const thumbnailImageSrcMapRef = useRef(thumbnailImageSrcMap);

  // Detect study changes and notify AIResultsService
  useStudyChangeDetector({
    servicesManager,
    viewportGridService,
    displaySetService,
    activeViewportId,
    viewports,
    StudyInstanceUIDs,
  });

  // One-shot: resolve the initially-selected AI result for the open studies.
  // Kept separate from the subscription (below) so it does not re-run on every
  // loading/thumbnail tick (VAR-M5).
  useEffect(() => {
    const initialUID = resolveInitialSelectedSRUID(StudyInstanceUIDs, aiResultsService, servicesManager);
    if (initialUID) {
      setSelectedSRUID(initialUID);
    }
  }, [aiResultsService, StudyInstanceUIDs, servicesManager]);

  // Subscribe once to global AI result selection and cleared events. Deps are
  // limited to stable services so the subscription is not torn down on every
  // loading tick; the cleared handler reads mutable state through refs.
  useEffect(() => {
    if (!aiResultsService) {
      return;
    }

    const selectionHandler = (evt: { studyInstanceUID: string; displaySetInstanceUID: string }) => {
      setSelectedSRUID(evt.displaySetInstanceUID);
    };

    const clearedHandler = (evt: { studyInstanceUID: string; displaySetUIDs?: string[]; reason?: string }) => {
      // If the currently selected AI result was deleted, clear selection
      if (evt.displaySetUIDs && selectedSRUIDRef.current && evt.displaySetUIDs.includes(selectedSRUIDRef.current)) {
        setSelectedSRUID(null);
      } else if (evt.reason === 'no_results' || evt.reason === 'cache_cleared') {
        // If all results were cleared, clear selection
        setSelectedSRUID(null);
      }

      // Force remapping of display sets to refresh thumbnails so the UI reflects
      // the deletion. Reads mutable state via refs to keep the subscription stable.
      const currentDisplaySets = displaySetService.activeDisplaySets;
      if (currentDisplaySets.length > 0) {
        setDisplaySets(
          mapDisplaySets({
            displaySets: currentDisplaySets,
            displaySetLoadingState: displaySetsLoadingStateRef.current,
            thumbnailImageSrcMap: thumbnailImageSrcMapRef.current,
            trackedSeriesInstanceUIDs: [],
            selectedSRUID: selectedSRUIDRef.current,
            thumbnailPropsCache,
          })
        );
      }
    };

    const selectedSubscription = aiResultsService.subscribe(
      aiResultsService.EVENTS.AI_RESULT_SELECTED,
      selectionHandler
    );

    const clearedSubscription = aiResultsService.subscribe(
      aiResultsService.EVENTS.AI_RESULT_CLEARED,
      clearedHandler
    );

    return () => {
      selectedSubscription.unsubscribe();
      clearedSubscription.unsubscribe();
    };
  }, [aiResultsService, displaySetService, thumbnailPropsCache]);

  const [viewPresets, setViewPresets] = useState(
    customizationService.getCustomization('studyBrowser.viewPresets')
  );

  const [actionIcons, setActionIcons] = useState(defaultActionIcons);

  // AI Results Service is now accessed from servicesManager

  const updateActionIconValue = actionIcon => {
    actionIcon.value = !actionIcon.value;
    const newActionIcons = [...actionIcons];
    setActionIcons(newActionIcons);
  };

  const updateViewPresetValue = viewPreset => {
    if (!viewPreset) {
      return;
    }
    const newViewPresets = viewPresets.map(preset => {
      preset.selected = preset.id === viewPreset.id;
      return preset;
    });
    setViewPresets(newViewPresets);
  };

  const onDoubleClickThumbnailHandler = displaySetInstanceUID => {
    // Check if this is an AI result thumbnail
    const displaySet = displaySets.find((ds: DisplaySet) => ds.displaySetInstanceUID === displaySetInstanceUID);
    const modality = displaySet?.modality || displaySet?.Modality;
    const isAIResult = displaySet && isAIResultModality(modality);

    // Don't change viewport for AI results
    if (isAIResult) {

      return;
    }

    let updatedViewports = [];
    const viewportId = activeViewportId;
    try {
      updatedViewports = hangingProtocolService.getViewportsRequireUpdate(
        viewportId,
        displaySetInstanceUID,
        isHangingProtocolLayout
      );
    } catch (error) {
      console.warn(error);
      uiNotificationService.show({
        title: 'Thumbnail Double Click',
        message:
          'The selected display sets could not be added to the viewport due to a mismatch in the Hanging Protocol rules.',
        type: 'error',
        duration: 3000,
      });
    }

    viewportGridService.setDisplaySetsForViewports(updatedViewports);
  };

  // Handle thumbnail click for AI result selection
  const onClickThumbnailHandler = (displaySetInstanceUID: string) => {
    const displaySet = displaySets.find((ds: DisplaySet) => ds.displaySetInstanceUID === displaySetInstanceUID);

    if (!displaySet) {

      return;
    }

    // Debug: Log the display set properties to see what's available

    // Check multiple modality property variations
    const modality = displaySet.modality || displaySet.Modality;
    const isAIResult = isAIResultModality(modality);

    if (isAIResult) {
      // Handle AI result selection
      const studyInstanceUID = displaySet.StudyInstanceUID || displaySet.studyInstanceUID;

      // Set selected AI result using the service
      if (aiResultsService && studyInstanceUID) {
        try {
          aiResultsService.setSelectedAIResult(studyInstanceUID, displaySetInstanceUID, servicesManager);
        } catch (error) {
          console.error('Error calling aiResultsService.setSelectedAIResult:', error);
        }
      } else {
        console.error('aiResultsService not available or missing studyInstanceUID', {
          hasService: !!aiResultsService,
          hasUID: !!studyInstanceUID
        });
      }

      // Local selection state removed – the global service event will update UI

    } else {
      // For medical images, we could implement different behavior if needed

    }
  };

  const activeViewportDisplaySetInstanceUIDs = activeViewportId
    ? (viewports.get(activeViewportId)?.displaySetInstanceUIDs || [])
    : [];

  useEffect(() => {
    setActiveTabName(tabMode === 'study-ai-subtabs' ? 'all' : studyMode);
  }, [studyMode, tabMode]);

  // ~~ studyDisplayList
  useEffect(() => {
    // Fetch all studies for the patient in each primary study
    async function fetchStudiesForPatient(StudyInstanceUID) {
      // current study qido
      const qidoForStudyUID = await dataSource.query.studies.search({
        studyInstanceUid: StudyInstanceUID,
      });

      if (!qidoForStudyUID?.length) {
        navigate('/notfoundstudy', { replace: true });
        throw new Error('Invalid study URL');
      }

      let qidoStudiesForPatient = qidoForStudyUID;

      // try to fetch the prior studies based on the patientID if the
      // server can respond.
      try {
        qidoStudiesForPatient = await getStudiesForPatientByMRN(qidoForStudyUID);
      } catch (error) {
        console.warn(error);
      }

      const mappedStudies = mapDataSourceStudies(qidoStudiesForPatient);
      const actuallyMappedStudies = mappedStudies.map(qidoStudy => {
        return {
          studyInstanceUid: qidoStudy.StudyInstanceUID,
          date: formatDate(qidoStudy.StudyDate) || t('NoStudyDate'),
          description: qidoStudy.StudyDescription,
          modalities: qidoStudy.ModalitiesInStudy,
          numInstances: qidoStudy.NumInstances,
        };
      });

      setStudyDisplayList(prevArray => {
        const ret = [...prevArray];
        for (const study of actuallyMappedStudies) {
          if (!prevArray.find(it => it.studyInstanceUid === study.studyInstanceUid)) {
            ret.push(study);
          }
        }
        return ret;
      });
    }

    // Catch each invocation: fetchStudiesForPatient throws 'Invalid study URL'
    // after navigating to /notfoundstudy, which would otherwise surface as an
    // unhandled promise rejection (the navigation is the real side effect).
    StudyInstanceUIDs.forEach(sid =>
      fetchStudiesForPatient(sid).catch(error => {
        console.warn('fetchStudiesForPatient failed', error);
      })
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [StudyInstanceUIDs, getStudiesForPatientByMRN]);

  // ~~ displaySets
  useEffect(() => {
    const currentDisplaySets = displaySetService.activeDisplaySets;

    if (!currentDisplaySets.length) {
      return;
    }

    const mappedDisplaySets = mapDisplaySets({
      displaySets: currentDisplaySets,
      displaySetLoadingState: displaySetsLoadingState,
      thumbnailImageSrcMap,
      trackedSeriesInstanceUIDs: [],
      selectedSRUID: selectedSRUIDRef.current,
      thumbnailPropsCache,
    });

    setDisplaySets(mappedDisplaySets);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    displaySetService.activeDisplaySets,
    displaySetsLoadingState,
    viewports,
    dataSource,
    thumbnailImageSrcMap,
  ]);

  // -- displaySetsLoadingState
  useEffect(() => {
    const { unsubscribe } = studyPrefetcherService.subscribe(
      studyPrefetcherService.EVENTS.DISPLAYSET_LOAD_PROGRESS,
      updatedDisplaySetLoadingState => {
        const { displaySetInstanceUID, loadingProgress } = updatedDisplaySetLoadingState;

        setDisplaySetsLoadingState(prevState => ({
          ...prevState,
          [displaySetInstanceUID]: loadingProgress,
        }));
      }
    );

    return () => unsubscribe();
  }, [studyPrefetcherService]);

  const lastSignatureRef = useRef<string>('');
  // Refs to hold latest dynamic state for the subscription callback
  // (displaySetsLoadingStateRef / thumbnailImageSrcMapRef are declared above,
  // before the AI-selection subscription that reads them).
  const viewportsRef = useRef(viewports);
  const debounceTimeoutRef = useRef<number | null>(null);

  // Helper to perform expensive remap and state update
  const runMapping = (displaySetsInput) => {
    const mappedDisplaySets = mapDisplaySets({
      displaySets: displaySetsInput,
      displaySetLoadingState: displaySetsLoadingStateRef.current,
      thumbnailImageSrcMap: thumbnailImageSrcMapRef.current,
      trackedSeriesInstanceUIDs: [],
      selectedSRUID: selectedSRUIDRef.current,
      thumbnailPropsCache,
    });

    const sig = mappedDisplaySets
      .map(ds => `${ds.displaySetInstanceUID}:${ds.loadingProgress || 0}`)
      .join('|');
    if (sig === lastSignatureRef.current) {
      return;
    }
    lastSignatureRef.current = sig;
    setDisplaySets(mappedDisplaySets);
  };

  // Keep refs in sync with state
  useEffect(() => {
    displaySetsLoadingStateRef.current = displaySetsLoadingState;
  }, [displaySetsLoadingState]);

  useEffect(() => {
    thumbnailImageSrcMapRef.current = thumbnailImageSrcMap;
  }, [thumbnailImageSrcMap]);

  useEffect(() => {
    viewportsRef.current = viewports;
  }, [viewports]);

  // ~~ subscriptions --> displaySets (DISPLAY_SETS_CHANGED)
  useEffect(() => {
    // Subscribe once – dependencies kept stable via refs to avoid resubscribe churn
    const SubscriptionDisplaySetsChanged = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_CHANGED,
      changedDisplaySets => {
        // Always clear previous debounce and schedule a new one
        if (debounceTimeoutRef.current !== null) {
          clearTimeout(debounceTimeoutRef.current);
        }
        // Run mapping after small delay to batch rapid updates
        debounceTimeoutRef.current = window.setTimeout(() => {
          debounceTimeoutRef.current = null;
          runMapping(changedDisplaySets);
        }, 150); // 150ms debounce – adjust as needed
      }
    );

    return () => {
      if (debounceTimeoutRef.current !== null) {
        clearTimeout(debounceTimeoutRef.current);
      }
      SubscriptionDisplaySetsChanged.unsubscribe();
    };
  }, [displaySetService, viewportGridService, dataSource, uiDialogService, uiNotificationService, thumbnailPropsCache]);

  // ~~ Initial Thumbnails
  useEffect(() => {
    // Step 1 – wait until the viewport layout is ready once we have an active viewport id
    if (!hasLoadedViewports) {
      if (activeViewportId) {
        // Delay a little to allow viewports to be hydrated first – improves perceived performance
        const delayMs = 250 + displaySetService.getActiveDisplaySets().length * 10;
        const timer = window.setTimeout(() => setHasLoadedViewports(true), delayMs);
        // L-15: cancel the pending timer on unmount / dependency change so we
        // don't call setState after unmount.
        return () => window.clearTimeout(timer);
      }

      return; // Exit early until `hasLoadedViewports` is true
    }

    // Step 2 – once ready, grab the current display sets that have cornerstone-renderable images
    let currentDisplaySets = displaySetService.activeDisplaySets;
    currentDisplaySets = currentDisplaySets.filter(
      ds => !thumbnailNoImageModalities.includes(ds.Modality)
    );

    if (!currentDisplaySets.length) {
      return;
    }

    // Step 3 – for every display set, find a representative image and render a thumbnail src
    currentDisplaySets.forEach(async dSet => {
      const newImageSrcEntry: Record<string, string> = {};
      const displaySet = displaySetService.getDisplaySetByUID(dSet.displaySetInstanceUID);

      const imageIds = dataSource.getImageIdsForDisplaySet(displaySet);
      const imageId = getImageIdForThumbnail(displaySet, imageIds);

      // Skip unsupported or non-image display sets (SEG / SR, etc.)
      if (!imageId || displaySet?.unsupported) {
        return;
      }

      // If the display set already contains a `thumbnailSrc` we can reuse it.
      let { thumbnailSrc } = displaySet as any;
      if (!thumbnailSrc && (displaySet as any).getThumbnailSrc) {
        thumbnailSrc = await (displaySet as any).getThumbnailSrc();
      }
      if (!thumbnailSrc) {
        thumbnailSrc = await getImageSrc(imageId);
        // Cache it on the display set for future reference
        (displaySet as any).thumbnailSrc = thumbnailSrc;
      }

      newImageSrcEntry[dSet.displaySetInstanceUID] = thumbnailSrc;

      setThumbnailImageSrcMap(prevState => ({ ...prevState, ...newImageSrcEntry }));
    });

    return undefined; // only the pre-load branch above registers a cleanup
  }, [displaySetService, dataSource, getImageSrc, activeViewportId, hasLoadedViewports]);

  // ~~ subscriptions --> displaySets (DISPLAY_SETS_ADDED)
  useEffect(() => {
    const SubscriptionDisplaySetsAdded = displaySetService.subscribe(
      displaySetService.EVENTS.DISPLAY_SETS_ADDED,
      data => {
        if (!hasLoadedViewports) {
          return;
        }

        const { displaySetsAdded, options } = data;

        displaySetsAdded.forEach(async dSet => {
          const displaySetInstanceUID = dSet.displaySetInstanceUID;
          const displaySet = displaySetService.getDisplaySetByUID(displaySetInstanceUID);

          if (displaySet?.unsupported) {
            return;
          }

          // If the display set was created on the client (e.g. derived) we want to scroll to it
          if (options?.madeInClient) {
            setJumpToDisplaySet(displaySetInstanceUID);
          }

          const imageIds = dataSource.getImageIdsForDisplaySet(displaySet);
          const imageId = getImageIdForThumbnail(displaySet, imageIds);
          if (!imageId) {
            return;
          }

          const newImageSrcEntry: Record<string, string> = {};
          newImageSrcEntry[displaySetInstanceUID] = await getImageSrc(imageId);

          setThumbnailImageSrcMap(prevState => ({ ...prevState, ...newImageSrcEntry }));
        });
      }
    );

    return () => {
      SubscriptionDisplaySetsAdded.unsubscribe();
    };
  }, [displaySetService, dataSource, getImageSrc, hasLoadedViewports]);

  const tabs = tabMode === 'study-ai-subtabs'
    ? createStudyAIBrowserTabsNested(
        StudyInstanceUIDs,
        studyDisplayList,
        displaySets,
        servicesManager
      )
    : createAIBrowserTabs(
        StudyInstanceUIDs,
        studyDisplayList,
        displaySets,
        servicesManager
      );

  // Ensure activeTabName is valid
  useEffect(() => {
    if (!tabs.find(t => t.name === activeTabName) && tabs.length) {
      setActiveTabName(tabs[0].name);
    }
  }, [tabs, activeTabName]);

  // Setup dynamic styling for AI thumbnails
  useEffect(() => {
    // Set up the mutation observer to watch for new thumbnails
    const disconnectObserver = setupAIThumbnailObserver();

    // Apply initial styling
    applyAIThumbnailStyles();

    // Apply styling when tabs or data changes (but not continuously)
    // Only run once when tabs/activeTabName changes
    const timeoutId = setTimeout(() => {
      applyAIThumbnailStyles();
    }, 100); // Single timeout instead of continuous interval

    return () => {
      clearTimeout(timeoutId);
      // Disconnect the MutationObserver on unmount so its full-subtree sweep stops.
      disconnectObserver();
    };
  }, [tabs, activeTabName]);

  // TODO: Should not fire this on "close"
  function _handleStudyClick(StudyInstanceUID) {
    const shouldCollapseStudy = expandedStudyInstanceUIDs.includes(StudyInstanceUID);
    const updatedExpandedStudyInstanceUIDs = shouldCollapseStudy
      ? [...expandedStudyInstanceUIDs.filter(stdyUid => stdyUid !== StudyInstanceUID)]
      : [...expandedStudyInstanceUIDs, StudyInstanceUID];

    setExpandedStudyInstanceUIDs(updatedExpandedStudyInstanceUIDs);

    // Load display sets for the study when it's expanded
    if (!shouldCollapseStudy) {
      const madeInClient = true;
      requestDisplaySetCreationForStudy(displaySetService, StudyInstanceUID, madeInClient);
    }
  }

  useEffect(() => {
    if (jumpToDisplaySet) {
      // Get element by displaySetInstanceUID
      const displaySetInstanceUID = jumpToDisplaySet;
      const element = document.getElementById(`thumbnail-${displaySetInstanceUID}`);

      if (element && typeof element.scrollIntoView === 'function') {
        // TODO: Any way to support IE here?
        element.scrollIntoView({ behavior: 'smooth' });

        setJumpToDisplaySet(null);
      }
    }
  }, [jumpToDisplaySet, expandedStudyInstanceUIDs, activeTabName]);

  useEffect(() => {
    if (!jumpToDisplaySet) {
      return;
    }

    const displaySetInstanceUID = jumpToDisplaySet;
    // Set the activeTabName and expand the study
    const thumbnailLocation = findTabAndStudyOfDisplaySet(displaySetInstanceUID, tabs);
    if (!thumbnailLocation) {
      console.warn('jumpToThumbnail: displaySet thumbnail not found.');

      return;
    }
    const { tabName, StudyInstanceUID } = thumbnailLocation;
    setActiveTabName(tabName);
    const studyExpanded = expandedStudyInstanceUIDs.includes(StudyInstanceUID);
    if (!studyExpanded) {
      const updatedExpandedStudyInstanceUIDs = [...expandedStudyInstanceUIDs, StudyInstanceUID];
      setExpandedStudyInstanceUIDs(updatedExpandedStudyInstanceUIDs);
    }
  }, [expandedStudyInstanceUIDs, jumpToDisplaySet, tabs]);

  return (
    <>
      <>
        <PanelStudyBrowserHeader
          viewPresets={viewPresets}
          updateViewPresetValue={updateViewPresetValue}
          actionIcons={actionIcons}
          updateActionIconValue={updateActionIconValue}
        />
        <Separator
          orientation="horizontal"
          className="bg-black"
          thickness="2px"
        />
      </>

      {tabMode === 'study-ai-subtabs' ? (
        <StudyBrowserNested
          tabs={tabs as any}
          activeTabName={activeTabName}
          expandedStudyInstanceUIDs={expandedStudyInstanceUIDs}
          onClickStudy={_handleStudyClick}
          onClickTab={setActiveTabName}
          onClickThumbnail={onClickThumbnailHandler}
          onDoubleClickThumbnail={onDoubleClickThumbnailHandler}
          activeDisplaySetInstanceUIDs={activeViewportDisplaySetInstanceUIDs}
          servicesManager={servicesManager}
          showSettings={true}
          viewPresets={viewPresets}
          commandsManager={commandsManager}
        />
      ) : (
        <StudyBrowser
          tabs={tabs}
          servicesManager={servicesManager}
          activeTabName={activeTabName}
          expandedStudyInstanceUIDs={expandedStudyInstanceUIDs}
          onClickStudy={_handleStudyClick}
          onClickTab={clickedTabName => setActiveTabName(clickedTabName)}
          onClickThumbnail={onClickThumbnailHandler}
          onDoubleClickThumbnail={onDoubleClickThumbnailHandler}
          activeDisplaySetInstanceUIDs={activeViewportDisplaySetInstanceUIDs}
          showSettings={true}
          viewPresets={viewPresets}
          ThumbnailMenuItems={MoreDropdownMenu({
            commandsManager,
            servicesManager,
            menuItemsKey: 'studyBrowser.thumbnailMenuItems',
          })}
          StudyMenuItems={MoreDropdownMenu({
            commandsManager,
            servicesManager,
            menuItemsKey: 'studyBrowser.studyMenuItems',
          })}
        />
      )}

    </>
  );
}

PanelStudyBrowserTracking.propTypes = {
  dataSource: PropTypes.shape({
    getImageIdsForDisplaySet: PropTypes.func.isRequired,
  }).isRequired,
  getImageSrc: PropTypes.func.isRequired,
  getStudiesForPatientByMRN: PropTypes.func.isRequired,
  requestDisplaySetCreationForStudy: PropTypes.func.isRequired,
};
