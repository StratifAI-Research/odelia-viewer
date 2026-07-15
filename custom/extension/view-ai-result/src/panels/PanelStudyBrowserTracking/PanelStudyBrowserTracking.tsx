import React, { useState, useEffect, useMemo, useRef } from 'react';
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
import { extractAIResultData } from '../../utils/extractAIResultData';
import { applyAIThumbnailStyles, setupAIThumbnailObserver } from '../../utils/applyAIThumbnailStyles';
import { useStudyChangeDetector } from '../../hooks/useStudyChangeDetector';

import '../../components/AIThumbnail.css';
import { getStaticDate } from '../../utils/dateCache';

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

const thumbnailNoImageModalities = [
  'SR',
  'SEG',
  'SM',
  'RTSTRUCT',
  'RTPLAN',
  'RTDOSE',
  'DOC',
  'OT',
  'PMAP',
];

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

  // Detect study changes and notify AIResultsService
  useStudyChangeDetector({
    servicesManager,
    viewportGridService,
    displaySetService,
    activeViewportId,
    viewports,
    StudyInstanceUIDs,
  });

  // Subscribe once to global AI result selection and cleared events
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

      // Force remapping of display sets to refresh thumbnails
      // This will update the UI to reflect the deletion
      const currentDisplaySets = displaySetService.activeDisplaySets;
      if (currentDisplaySets.length > 0) {
        const mappedDisplaySets = _mapDisplaySets({
          displaySets: currentDisplaySets,
          displaySetLoadingState: displaySetsLoadingState,
          thumbnailImageSrcMap,
          trackedSeriesInstanceUIDs: [],
          selectedSRUID: selectedSRUIDRef.current,
          thumbnailPropsCache,
        });
        setDisplaySets(mappedDisplaySets);
      }
    };

    // Initial selection (if any)
    if (StudyInstanceUIDs?.length) {
      // Try each study, keep first valid selection we find
      for (const sid of StudyInstanceUIDs) {
        const initial = aiResultsService.getSelectedAIResult?.(sid, servicesManager as any);
        // `getSelectedAIResult` returns AIResult | null without UID, so rely on metadata helper
        if (!initial) {
          continue;
        }
        const metaList = aiResultsService.getAIResultMetadata?.(sid, servicesManager as any);
        const selectedMeta = metaList?.find(m => m.isSelected);
        if (selectedMeta) {
          setSelectedSRUID(selectedMeta.displaySetInstanceUID);
          break;
        }
      }
    }

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
  }, [
    aiResultsService,
    StudyInstanceUIDs,
    servicesManager,
    displaySetService,
    displaySetsLoadingState,
    thumbnailImageSrcMap,
    viewports,
    viewportGridService,
    dataSource,
    uiDialogService,
    uiNotificationService,
    thumbnailPropsCache
  ]);

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
    const isAIResult = displaySet && (modality === 'SR' || modality === 'SC');

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
    const isAIResult = modality === 'SR' || modality === 'SC';

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

      const mappedStudies = _mapDataSourceStudies(qidoStudiesForPatient);
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

    const mappedDisplaySets = _mapDisplaySets({
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
  const displaySetsLoadingStateRef = useRef(displaySetsLoadingState);
  const thumbnailImageSrcMapRef = useRef(thumbnailImageSrcMap);
  const viewportsRef = useRef(viewports);
  const debounceTimeoutRef = useRef<number | null>(null);

  // Helper to perform expensive remap and state update
  const runMapping = (displaySetsInput) => {
    const mappedDisplaySets = _mapDisplaySets({
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
        window.setTimeout(() => setHasLoadedViewports(true), delayMs);
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
      // Disconnect the MutationObserver on unmount; previously it kept running a
      // full-subtree querySelectorAll sweep for the life of the page.
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
    const thumbnailLocation = _findTabAndStudyOfDisplaySet(displaySetInstanceUID, tabs);
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

function getImageIdForThumbnail(displaySet: any, imageIds: any) {
  let imageId;
  if (displaySet.isDynamicVolume) {
    const timePoints = displaySet.dynamicVolumeInfo.timePoints;
    const middleIndex = Math.floor(timePoints.length / 2);
    const middleTimePointImageIds = timePoints[middleIndex];
    imageId = middleTimePointImageIds[Math.floor(middleTimePointImageIds.length / 2)];
  } else {
    imageId = imageIds[Math.floor(imageIds.length / 2)];
  }
  return imageId;
}

/**
 * Maps from the DataSource's format to a naturalized object
 *
 * @param {*} studies
 */
function _mapDataSourceStudies(studies) {
  return studies.map(study => {
    // TODO: Why does the data source return in this format?
    return {
      AccessionNumber: study.accession,
      StudyDate: study.date,
      StudyDescription: study.description,
      NumInstances: study.instances,
      ModalitiesInStudy: study.modalities,
      PatientID: study.mrn,
      PatientName: study.patientName,
      StudyInstanceUID: study.studyInstanceUid,
      StudyTime: study.time,
    };
  });
}

function _mapDisplaySets({
  displaySets,
  displaySetLoadingState,
  thumbnailImageSrcMap,
  trackedSeriesInstanceUIDs,
  selectedSRUID,
  thumbnailPropsCache = new Map(),
}) {

  const thumbnailDisplaySets: any[] = [];
  const thumbnailNoImageDisplaySets: any[] = [];
  displaySets
    .filter(ds => !ds.excludeFromThumbnailBrowser)
    .forEach(ds => {
      const { thumbnailSrc, displaySetInstanceUID } = ds;
      const componentType = _getComponentType(ds);

      const array =
        componentType === 'thumbnailTracked' ? thumbnailDisplaySets : thumbnailNoImageDisplaySets;

      const loadingProgress = displaySetLoadingState?.[displaySetInstanceUID];

      // Determine if this display set is an AI result (SR or SC)
      const isAIResultQuick = ds.Modality === 'SR' || ds.Modality === 'SC';
      const isSelectedSR = ds.Modality === 'SR' && displaySetInstanceUID === selectedSRUID;

      // Check if we have cached thumbnail props for this display set
      const cacheKey = `${displaySetInstanceUID}-${ds.SeriesDate || ds.StudyDate || ds.instance?.InstanceCreationDate}`;

      if (thumbnailPropsCache.has(cacheKey)) {

        const cachedProps = thumbnailPropsCache.get(cacheKey);
        // Update dynamic properties that can change
        cachedProps.loadingProgress = loadingProgress;
        cachedProps.imageSrc = thumbnailSrc || thumbnailImageSrcMap[displaySetInstanceUID];
        cachedProps.isTracked = trackedSeriesInstanceUIDs.includes(ds.SeriesInstanceUID);
        // Ensure className is updated for AI result styling & selection
        if (cachedProps && isAIResultQuick) {
          cachedProps.className = `ai-result-thumbnail${isSelectedSR ? ' selected' : ''}`;
        }
        array.push(cachedProps);
        return; // Skip recalculation
      }

      // If not cached, calculate the thumbnail props

      // Extract AI result data for AI results
      const aiResultData = extractAIResultData(ds);

      // Enhanced description for AI results - show all info directly
      let enhancedDescription = ds.SeriesDescription || '';

      // Get static date for this display set (prevent constant refreshing)
      const staticDate = getStaticDate(ds);

      if (aiResultData && aiResultData.modelInfo) {
        // Show all information directly - CSS should handle wrapping
        let lines = [`🤖 ${aiResultData.modelInfo.name}`];

        // Process real classification results from DICOM SR
        if (aiResultData.isClassification && aiResultData.classifications.length > 0) {
          aiResultData.classifications.forEach(classification => {
            const side = classification.side;

            if (classification.errorMessage) {
              // Handle error cases
              lines.push(`${side}: ${classification.errorMessage}`);
            } else if (classification.result !== null) {
              // Handle successful classification (3-class: Malignant, Benign, No lesion)
              const result = classification.result;
              const confidence =
                classification.confidence != null
                  ? ` ${classification.confidence.toFixed(1)}%`
                  : '';
              lines.push(`${side}: ${result}${confidence}`);
            }
          });
        } else {
          // No classification data found
          lines.push('No classification results');
        }

        // Join with line breaks - CSS should make this work
        enhancedDescription = lines.join('\n');

      } else if (ds.Modality === 'SR') {
        // Show meaningful info for SRs without parseable AI data
        enhancedDescription = `🤖 AI Result\n${ds.SeriesDescription || 'Structured Report'}`;

      } else if (ds.Modality === 'SC') {
        // Clean format for SC - show as Heatmap
        enhancedDescription = `🤖 Heatmap`;

      }

      // Final safety check
      if (!enhancedDescription || enhancedDescription.trim() === '') {
        enhancedDescription = 'Unknown Series';

      }

      // Add custom CSS class for AI results (SR and SC) to enable multiline text
      const isAIResult = aiResultData || ds.Modality === 'SR' || ds.Modality === 'SC';
      const customClassName = isAIResult ? `ai-result-thumbnail${isSelectedSR ? ' selected' : ''}` : '';

      // Cache the calculated thumbnail props (static properties only)
      const cacheableProps = {
        displaySetInstanceUID,
        description: enhancedDescription,
        seriesNumber: ds.SeriesNumber,
        modality: ds.Modality,
        seriesDate: staticDate, // This is the static date we want to preserve
        numInstances: ds.numImageFrames,
        countIcon: ds.countIcon,
        messages: null,
        StudyInstanceUID: ds.StudyInstanceUID,
        componentType,
        dragData: {
          type: 'displayset',
          displaySetInstanceUID,
        },
        isHydratedForDerivedDisplaySet: ds.isHydrated,
        // Dynamic properties that will be updated each time
        loadingProgress: loadingProgress,
        imageSrc: thumbnailSrc || thumbnailImageSrcMap[displaySetInstanceUID],
        isTracked: trackedSeriesInstanceUIDs.includes(ds.SeriesInstanceUID),
        className: customClassName,
      };

      // Save to cache for future use
      thumbnailPropsCache.set(cacheKey, { ...cacheableProps });

      array.push(cacheableProps);
    });

  return [...thumbnailDisplaySets, ...thumbnailNoImageDisplaySets];
}

function _getComponentType(ds) {
  if (thumbnailNoImageModalities.includes(ds.Modality) || ds?.unsupported) {
    return 'thumbnailNoImage';
  }

  return 'thumbnailTracked';
}

function _findTabAndStudyOfDisplaySet(displaySetInstanceUID, tabs) {
  for (let t = 0; t < tabs.length; t++) {
    const { studies } = tabs[t];

    for (let s = 0; s < studies.length; s++) {
      const study = studies[s];

      // Check in originals array (for nested structure)
      if (study.originals) {
        for (let d = 0; d < study.originals.length; d++) {
          if (study.originals[d].displaySetInstanceUID === displaySetInstanceUID) {
            return {
              tabName: tabs[t].name,
              StudyInstanceUID: study.studyInstanceUid,
            };
          }
        }
      }

      // Check in aiGroups array (for nested structure)
      if (study.aiGroups) {
        for (let g = 0; g < study.aiGroups.length; g++) {
          const group = study.aiGroups[g];
          if (group.displaySets) {
            for (let d = 0; d < group.displaySets.length; d++) {
              if (group.displaySets[d].displaySetInstanceUID === displaySetInstanceUID) {
                return {
                  tabName: tabs[t].name,
                  StudyInstanceUID: study.studyInstanceUid,
                };
              }
            }
          }
        }
      }

      // Fallback for flat structure (old tab mode)
      if (study.displaySets) {
        for (let d = 0; d < study.displaySets.length; d++) {
          if (study.displaySets[d].displaySetInstanceUID === displaySetInstanceUID) {
            return {
              tabName: tabs[t].name,
              StudyInstanceUID: study.studyInstanceUid,
            };
          }
        }
      }
    }
  }

  return undefined;
}
