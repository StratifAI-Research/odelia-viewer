import React from 'react';
import { installConsoleErrorFilter } from '../../test-utils/harness';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import PanelStudyBrowserTracking from './PanelStudyBrowserTracking';

// Drive viewport + image-viewer hooks per test.
let mockImageViewerReturn: any = { StudyInstanceUIDs: [] };
let mockViewportGridReturn: any;

jest.mock('@ohif/ui-next', () => {
  const actual = jest.requireActual('@ohif/ui-next');
  return {
    ...actual,
    useImageViewer: () => mockImageViewerReturn,
    useViewportGrid: () => mockViewportGridReturn,
  };
});
jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// Count observer setups / style sweeps so a re-render storm is visible to the test.
const mockDisconnectObserver = jest.fn();
const mockSetupAIThumbnailObserver = jest.fn(() => mockDisconnectObserver);
const mockApplyAIThumbnailStyles = jest.fn();
jest.mock('../../utils/applyAIThumbnailStyles', () => ({
  setupAIThumbnailObserver: () => mockSetupAIThumbnailObserver(),
  applyAIThumbnailStyles: () => mockApplyAIThumbnailStyles(),
}));

// Mapped display-set thumbnail objects come from displaySetService.activeDisplaySets.
const mrDs = (over: any = {}) => ({
  displaySetInstanceUID: 'mr-1',
  Modality: 'MR',
  SeriesInstanceUID: 'se-mr-1',
  SeriesDescription: 'T1 axial',
  SeriesNumber: 1,
  StudyInstanceUID: 'study-1',
  numImageFrames: 30,
  ...over,
});
const srDs = (over: any = {}) => ({
  displaySetInstanceUID: 'sr-1',
  Modality: 'SR',
  SeriesInstanceUID: 'se-sr-1',
  SeriesDescription: 'AI Report',
  SeriesNumber: 99,
  StudyInstanceUID: 'study-1',
  numImageFrames: 1,
  instance: { InstanceCreationDate: '20240315', InstanceCreationTime: '100000' },
  ...over,
});

function makeDisplaySetService(active: any[] = []) {
  const byUid: Record<string, any> = {};
  active.forEach(ds => (byUid[ds.displaySetInstanceUID] = ds));
  return {
    activeDisplaySets: active,
    getActiveDisplaySets: jest.fn(() => active),
    getDisplaySetByUID: jest.fn((uid: string) => byUid[uid] || null),
    subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
    EVENTS: { DISPLAY_SETS_CHANGED: 'changed', DISPLAY_SETS_ADDED: 'added' },
  };
}

function makeServices(opts: any = {}) {
  const {
    active = [],
    tabMode = 'default',
    studyMode = 'all',
    aiResultsService,
    displaySetServiceOver,
  } = opts;
  const customizations: Record<string, any> = {
    'studyBrowser.studyMode': studyMode,
    'studyBrowser.tabMode': tabMode,
    'studyBrowser.viewPresets': [{ id: 'p1', selected: true }],
  };
  return {
    services: {
      displaySetService: { ...makeDisplaySetService(active), ...displaySetServiceOver },
      uiDialogService: { show: jest.fn(), hide: jest.fn() },
      hangingProtocolService: {
        getActiveProtocol: jest.fn(() => ({})),
        getViewportsRequireUpdate: jest.fn(() => [
          { viewportId: 'v1', displaySetInstanceUIDs: ['mr-1'] },
        ]),
      },
      uiNotificationService: { show: jest.fn() },
      studyPrefetcherService: {
        subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
        EVENTS: { DISPLAYSET_LOAD_PROGRESS: 'progress' },
      },
      customizationService: { getCustomization: jest.fn((k: string) => customizations[k]) },
      uiModalService: { show: jest.fn() },
      aiResultsService: aiResultsService ?? {
        EVENTS: { AI_RESULT_SELECTED: 'sel', AI_RESULT_CLEARED: 'clr' },
        subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
        getSelectedAIResult: jest.fn(() => null),
        getAIResultMetadata: jest.fn(() => []),
        setSelectedAIResult: jest.fn(),
        notifyStudyChange: jest.fn(),
      },
    },
    commandsManager: { runCommand: jest.fn() },
    extensionManager: { getModuleEntry: jest.fn() },
  };
}

function makeProps(over: any = {}) {
  return {
    getImageSrc: jest.fn(async () => 'data:image/png;base64,AAA'),
    getStudiesForPatientByMRN: jest.fn(async (q: any) => q),
    requestDisplaySetCreationForStudy: jest.fn(),
    dataSource: {
      query: {
        studies: {
          search: jest.fn(async () => [{ StudyInstanceUID: 'study-1', StudyDate: '20240315' }]),
        },
      },
      getImageIdsForDisplaySet: jest.fn(() => ['img-1', 'img-2', 'img-3']),
    },
    ...over,
  };
}

// Wire the system context the panel reads from useSystem().
function setSystem(svc: any) {
  (globalThis as any).__OHIF_SYSTEM__ = {
    servicesManager: svc,
    commandsManager: svc.commandsManager,
    extensionManager: svc.extensionManager,
  };
}

installConsoleErrorFilter({ silenceLog: true, silenceWarn: true });

beforeEach(() => {
  jest.clearAllMocks();
  mockImageViewerReturn = { StudyInstanceUIDs: [] };
  mockViewportGridReturn = [
    { activeViewportId: null, viewports: new Map(), isHangingProtocolLayout: false },
    { setDisplaySetsForViewports: jest.fn(), setActiveViewportId: jest.fn() },
  ];
});

async function renderPanel(svc: any, props = makeProps()) {
  setSystem(svc);
  let utils: any;
  await act(async () => {
    utils = render(
      <MemoryRouter>
        <PanelStudyBrowserTracking {...props} />
      </MemoryRouter>
    );
  });
  return { ...utils, svc, props };
}

describe('PanelStudyBrowserTracking', () => {
  it('renders the empty study browser (no display sets, no studies)', async () => {
    const svc = makeServices({ active: [] });
    await renderPanel(svc);
    const browser = screen.getByTestId('study-browser');
    // No tabs built when there are no display sets.
    expect(browser.getAttribute('data-count')).toBe('0');
    // Header + separator always render.
    expect(screen.getByTestId('study-browser-header')).toBeTruthy();
    expect(screen.getByTestId('separator')).toBeTruthy();
  });

  it('builds an Original tab with a thumbnail from a non-AI display set', async () => {
    mockImageViewerReturn = { StudyInstanceUIDs: ['study-1'] };
    const svc = makeServices({ active: [mrDs()] });
    await renderPanel(svc);
    // createAIBrowserTabs groups the MR series into an "original" tab.
    expect(screen.getByTestId('sb-tab-original')).toBeTruthy();
    expect(screen.getByTestId('sb-thumb-mr-1')).toBeTruthy();
  });

  it('builds separate AI tab(s) when SR/SC results are present alongside originals', async () => {
    mockImageViewerReturn = { StudyInstanceUIDs: ['study-1'] };
    const svc = makeServices({ active: [mrDs(), srDs()] });
    await renderPanel(svc);
    expect(screen.getByTestId('sb-tab-original')).toBeTruthy();
    // An AI tab is added for the SR result, plus an "all" tab (>1 tab).
    expect(screen.getByTestId('sb-tab-all')).toBeTruthy();
    expect(screen.getByTestId('sb-tab-ai-0')).toBeTruthy();
    // The SR thumbnail lives under the "all" tab.
    await act(async () => {
      fireEvent.click(screen.getByTestId('sb-tab-all'));
    });
    expect(screen.getByTestId('sb-thumb-sr-1')).toBeTruthy();
  });

  it('switches the active tab when a tab is clicked', async () => {
    mockImageViewerReturn = { StudyInstanceUIDs: ['study-1'] };
    const svc = makeServices({ active: [mrDs(), srDs()] });
    await renderPanel(svc);
    await act(async () => {
      fireEvent.click(screen.getByTestId('sb-tab-all'));
    });
    expect(screen.getByTestId('study-browser').getAttribute('data-active-tab')).toBe('all');
  });

  it('clicking an AI-result thumbnail selects it via aiResultsService.setSelectedAIResult', async () => {
    mockImageViewerReturn = { StudyInstanceUIDs: ['study-1'] };
    const svc = makeServices({ active: [mrDs(), srDs()] });
    await renderPanel(svc);
    await act(async () => {
      fireEvent.click(screen.getByTestId('sb-tab-all'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('sb-thumb-click-sr-1'));
    });
    expect(svc.services.aiResultsService.setSelectedAIResult).toHaveBeenCalledWith(
      'study-1',
      'sr-1',
      expect.anything()
    );
  });

  it('clicking a non-AI thumbnail does NOT call the AI selection service', async () => {
    mockImageViewerReturn = { StudyInstanceUIDs: ['study-1'] };
    const svc = makeServices({ active: [mrDs()] });
    await renderPanel(svc);
    await act(async () => {
      fireEvent.click(screen.getByTestId('sb-thumb-click-mr-1'));
    });
    expect(svc.services.aiResultsService.setSelectedAIResult).not.toHaveBeenCalled();
  });

  it('double-clicking a non-AI thumbnail updates the viewport grid', async () => {
    mockImageViewerReturn = { StudyInstanceUIDs: ['study-1'] };
    mockViewportGridReturn = [
      { activeViewportId: 'v1', viewports: new Map(), isHangingProtocolLayout: false },
      { setDisplaySetsForViewports: jest.fn(), setActiveViewportId: jest.fn() },
    ];
    const svc = makeServices({ active: [mrDs()] });
    await renderPanel(svc);
    await act(async () => {
      fireEvent.click(screen.getByTestId('sb-thumb-dblclick-mr-1'));
    });
    expect(svc.services.hangingProtocolService.getViewportsRequireUpdate).toHaveBeenCalledWith(
      'v1',
      'mr-1',
      false
    );
    expect(mockViewportGridReturn[1].setDisplaySetsForViewports).toHaveBeenCalled();
  });

  it('double-clicking an AI-result thumbnail is ignored (no viewport change)', async () => {
    mockImageViewerReturn = { StudyInstanceUIDs: ['study-1'] };
    mockViewportGridReturn = [
      { activeViewportId: 'v1', viewports: new Map(), isHangingProtocolLayout: false },
      { setDisplaySetsForViewports: jest.fn(), setActiveViewportId: jest.fn() },
    ];
    const svc = makeServices({ active: [mrDs(), srDs()] });
    await renderPanel(svc);
    await act(async () => {
      fireEvent.click(screen.getByTestId('sb-tab-all'));
    });
    await act(async () => {
      fireEvent.click(screen.getByTestId('sb-thumb-dblclick-sr-1'));
    });
    expect(svc.services.hangingProtocolService.getViewportsRequireUpdate).not.toHaveBeenCalled();
    expect(mockViewportGridReturn[1].setDisplaySetsForViewports).not.toHaveBeenCalled();
  });

  it('subscribes to AI selection/cleared events and unsubscribes on unmount', async () => {
    mockImageViewerReturn = { StudyInstanceUIDs: ['study-1'] };
    const selUnsub = jest.fn();
    const clrUnsub = jest.fn();
    const aiResultsService = {
      EVENTS: { AI_RESULT_SELECTED: 'sel', AI_RESULT_CLEARED: 'clr' },
      subscribe: jest
        .fn()
        .mockImplementationOnce(() => ({ unsubscribe: selUnsub }))
        .mockImplementationOnce(() => ({ unsubscribe: clrUnsub })),
      getSelectedAIResult: jest.fn(() => null),
      getAIResultMetadata: jest.fn(() => []),
      setSelectedAIResult: jest.fn(),
      notifyStudyChange: jest.fn(),
    };
    const svc = makeServices({ active: [mrDs()], aiResultsService });
    const { unmount } = await renderPanel(svc);
    expect(aiResultsService.subscribe).toHaveBeenCalledWith('sel', expect.any(Function));
    expect(aiResultsService.subscribe).toHaveBeenCalledWith('clr', expect.any(Function));
    unmount();
    expect(selUnsub).toHaveBeenCalled();
    expect(clrUnsub).toHaveBeenCalled();
  });

  it('unsubscribes from the study prefetcher and display-set change subscriptions on unmount', async () => {
    mockImageViewerReturn = { StudyInstanceUIDs: ['study-1'] };
    const prefetchUnsub = jest.fn();
    const changedUnsub = jest.fn();
    const addedUnsub = jest.fn();
    const svc = makeServices({ active: [mrDs()] });
    svc.services.studyPrefetcherService.subscribe = jest.fn(() => ({ unsubscribe: prefetchUnsub }));
    svc.services.displaySetService.subscribe = jest
      .fn()
      .mockImplementationOnce(() => ({ unsubscribe: changedUnsub }))
      .mockImplementationOnce(() => ({ unsubscribe: addedUnsub }));
    const { unmount } = await renderPanel(svc);
    unmount();
    expect(prefetchUnsub).toHaveBeenCalled();
    expect(changedUnsub).toHaveBeenCalled();
    expect(addedUnsub).toHaveBeenCalled();
  });

  it('reflects a globally-selected AI result (selected styling marks the SR thumbnail)', async () => {
    mockImageViewerReturn = { StudyInstanceUIDs: ['study-1'] };
    const aiResultsService = {
      EVENTS: { AI_RESULT_SELECTED: 'sel', AI_RESULT_CLEARED: 'clr' },
      subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
      // Initial selection resolves to sr-1 via metadata helper.
      getSelectedAIResult: jest.fn(() => ({ id: 'res-1' })),
      getAIResultMetadata: jest.fn(() => [{ displaySetInstanceUID: 'sr-1', isSelected: true }]),
      setSelectedAIResult: jest.fn(),
      notifyStudyChange: jest.fn(),
    };
    const svc = makeServices({ active: [mrDs(), srDs()], aiResultsService });
    await renderPanel(svc);
    // The subscription effect reads initial selection from the metadata helper.
    expect(aiResultsService.getSelectedAIResult).toHaveBeenCalledWith('study-1', expect.anything());
    expect(aiResultsService.getAIResultMetadata).toHaveBeenCalled();
    await act(async () => {
      fireEvent.click(screen.getByTestId('sb-tab-all'));
    });
    expect(screen.getByTestId('sb-thumb-sr-1')).toBeTruthy();
  });

  it('renders the nested study browser when tabMode is study-ai-subtabs', async () => {
    mockImageViewerReturn = { StudyInstanceUIDs: ['study-1'] };
    const svc = makeServices({ active: [mrDs(), srDs()], tabMode: 'study-ai-subtabs' });
    await renderPanel(svc);
    // Nested variant renders instead of the flat StudyBrowser.
    expect(screen.queryByTestId('study-browser')).toBeNull();
    expect(screen.getByTestId('study-browser-header')).toBeTruthy();
  });

  // Regression: `tabs` is rebuilt on every render, and the styling effect used it
  // as a dependency. A fresh array identity per render meant every render tore
  // down and recreated the MutationObserver and re-ran applyAIThumbnailStyles()'s
  // document-wide querySelectorAll sweep. The effect is keyed on the tab names now,
  // so renders that leave the tab set alone must not touch either.
  it('does not recreate the thumbnail observer on renders that leave the tabs unchanged', async () => {
    mockImageViewerReturn = { StudyInstanceUIDs: ['study-1'] };
    const svc = makeServices({ active: [mrDs(), srDs()] });
    const { rerender, props } = await renderPanel(svc);

    // Mount may legitimately settle over more than one render, so compare against
    // the post-mount count rather than asserting an absolute number.
    const setupsAfterMount = mockSetupAIThumbnailObserver.mock.calls.length;
    const sweepsAfterMount = mockApplyAIThumbnailStyles.mock.calls.length;
    const disconnectsAfterMount = mockDisconnectObserver.mock.calls.length;
    expect(setupsAfterMount).toBeGreaterThan(0);

    for (let i = 0; i < 3; i++) {
      await act(async () => {
        rerender(
          <MemoryRouter>
            <PanelStudyBrowserTracking {...props} />
          </MemoryRouter>
        );
      });
    }

    expect(mockSetupAIThumbnailObserver.mock.calls.length).toBe(setupsAfterMount);
    expect(mockApplyAIThumbnailStyles.mock.calls.length).toBe(sweepsAfterMount);
    expect(mockDisconnectObserver.mock.calls.length).toBe(disconnectsAfterMount);
  });
});
