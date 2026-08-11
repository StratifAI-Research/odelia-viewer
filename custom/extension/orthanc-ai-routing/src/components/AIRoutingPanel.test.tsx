import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AI_ENDPOINT } from '../test-utils/harness';

import AIRoutingPanel from './AIRoutingPanel';

// @ohif/core (imported transitively by the real useStudySeriesSelection) is mapped to
// a stub via moduleNameMapper (jest.config.js).

// Controllable viewport context. mock-prefixed so the jest.mock factories may close
// over it; a stable grid reference per test avoids effect churn / act warnings.
const mockViewport: any = {};
jest.mock('@ohif/ui-next', () => ({
  // moduleNameMapper already points '@ohif/ui-next' at the shared stub, so
  // requireActual returns it — keep its Button/Icons/... and override only the
  // two context hooks this suite needs to drive.
  ...jest.requireActual('@ohif/ui-next'),
  useImageViewer: () => ({ StudyInstanceUIDs: mockViewport.studyUIDs }),
  useViewportGrid: () => mockViewport.grid,
}));

// Capture the props each step / child is rendered with, so we can drive the
// wizard by invoking captured callbacks and assert the panel wires correct data.
const mockProps: any = {};
jest.mock('./steps/ModelSelectionStep', () => ({
  ModelSelectionStep: (p: any) => {
    mockProps.model = p;
    return <div data-testid="step-model" />;
  },
}));
jest.mock('./steps/SeriesSelectionStep', () => ({
  SeriesSelectionStep: (p: any) => {
    mockProps.series = p;
    return <div data-testid="step-series" />;
  },
}));
jest.mock('./steps/InputModeSelectionStep', () => ({
  InputModeSelectionStep: (p: any) => {
    mockProps.mode = p;
    return <div data-testid="step-mode" />;
  },
}));
jest.mock('./steps/InputMappingStep', () => ({
  InputMappingStep: (p: any) => {
    mockProps.mapping = p;
    return <div data-testid="step-mapping" />;
  },
}));
jest.mock('./steps/ConfirmStep', () => ({
  ConfirmStep: (p: any) => {
    mockProps.confirm = p;
    return <div data-testid="step-confirm" />;
  },
}));
jest.mock('./steps/ProgressStep', () => ({
  ProgressStep: (p: any) => {
    mockProps.progress = p;
    return <div data-testid="step-progress" />;
  },
}));
jest.mock('./AIEndpointConfig', () => ({
  __esModule: true,
  default: (p: any) => {
    mockProps.endpointConfig = p;
    return <div data-testid="endpoint-config" />;
  },
}));

const MANIFEST = {
  model_id: 'm',
  model_name: 'M',
  version: '1',
  input_configurations: [
    { id: 'c1', name: 'cfg', inputs: [{ key: 't1', label: 'T1', required: true }] },
  ],
};

function ds(over: Record<string, any> = {}) {
  return {
    StudyInstanceUID: '1.2.3',
    Modality: 'MR',
    displaySetInstanceUID: 'd1',
    SeriesInstanceUID: 's1',
    SeriesDescription: 'T1',
    SeriesNumber: 1,
    numImageFrames: 5,
    ...over,
  };
}

function makeServices(opts: { displaySets?: any[]; orthancAIService?: any } = {}) {
  const orthancAIService = {
    getDicomStudyInstanceUIDFromURL: jest.fn(() => null),
    getCurrentEndpoint: jest.fn(() => AI_ENDPOINT),
    setCurrentEndpoint: jest.fn(),
    routeSeriesToAI: jest
      .fn()
      .mockResolvedValue({ status: 'success', workitem_uid: 'w1', message: 'ok' }),
    startWorkitemPolling: jest.fn(),
    stopWorkitemPolling: jest.fn(),
    getModelManifest: jest.fn().mockResolvedValue(null),
    clearManifestCache: jest.fn(),
    ...opts.orthancAIService,
  };
  return {
    services: {
      orthancAIService,
      displaySetService: {
        EVENTS: { DISPLAY_SETS_CHANGED: 'changed' },
        getActiveDisplaySets: jest.fn(() => opts.displaySets || []),
        subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
        getDisplaySetByUID: jest.fn(),
      },
      uiNotificationService: { show: jest.fn() },
      customizationService: {
        getCustomization: jest.fn(() => ({ progress }: any) => <div>{progress}</div>),
      },
    },
  };
}

async function renderPanel(opts = {}) {
  const sm = makeServices(opts);
  render(<AIRoutingPanel servicesManager={sm as any} />);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(300);
  });
  return sm;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  for (const k of Object.keys(mockProps)) {
    delete mockProps[k];
  }
  mockViewport.studyUIDs = ['1.2.3'];
  mockViewport.grid = [{ activeViewportId: 'v1', viewports: new Map() }, {}];
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('AIRoutingPanel — rendering & navigation', () => {
  it('renders the header and step 1 (ModelSelectionStep) with wired props', async () => {
    const sm = await renderPanel();
    expect(screen.getByText('AI Analysis')).toBeTruthy();
    expect(screen.getByText('Step 1 of 4')).toBeTruthy();
    expect(screen.getByTestId('step-model')).toBeTruthy();
    expect(mockProps.model.orthancAIService).toBe(sm.services.orthancAIService);
    expect(mockProps.model.currentEndpoint).toEqual(AI_ENDPOINT);
    expect(mockProps.model.manifest).toBeNull();
  });

  it('advances to the series step when there is no manifest', async () => {
    await renderPanel();
    act(() => mockProps.model.onNext());
    expect(screen.getByTestId('step-series')).toBeTruthy();
    expect(screen.getByText('Step 2 of 4')).toBeTruthy();
  });

  it('switches to the 5-step manifest flow and shows the input-mode step', async () => {
    await renderPanel();
    act(() => mockProps.model.onManifestLoaded(MANIFEST));
    expect(screen.getByText('Step 1 of 5')).toBeTruthy();
    act(() => mockProps.model.onNext());
    expect(screen.getByTestId('step-mode')).toBeTruthy();
  });

  it('opens and closes the endpoint-settings overlay', async () => {
    await renderPanel();
    expect(screen.queryByTestId('endpoint-config')).toBeNull();
    fireEvent.click(screen.getByTitle('Endpoint Settings'));
    expect(screen.getByTestId('endpoint-config')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Close endpoint settings'));
    expect(screen.queryByTestId('endpoint-config')).toBeNull();
  });
});

describe('AIRoutingPanel — study derivation', () => {
  it('derives the study UID from the active viewport display set, not the fallback', async () => {
    mockViewport.studyUIDs = ['fallback-uid'];
    mockViewport.grid = [
      { activeViewportId: 'v1', viewports: new Map([['v1', { displaySetInstanceUIDs: ['dsX'] }]]) },
      {},
    ];
    const sm = makeServices({
      displaySets: [ds({ StudyInstanceUID: '9.9.9', SeriesInstanceUID: 's9' })],
    });
    sm.services.displaySetService.getDisplaySetByUID = jest.fn(() => ({
      StudyInstanceUID: '9.9.9',
    }));
    render(<AIRoutingPanel servicesManager={sm as any} />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(300);
    });

    act(() => mockProps.model.onNext());
    act(() => mockProps.series.onNext());
    await act(async () => {
      await mockProps.confirm.onSend();
    });
    // study derived from the viewport's display set (9.9.9), not the useImageViewer fallback
    expect(sm.services.displaySetService.getDisplaySetByUID).toHaveBeenCalledWith('dsX');
    expect(sm.services.orthancAIService.routeSeriesToAI.mock.calls[0][0]).toBe('9.9.9');
  });

  it('resets the wizard when the active study changes mid-flow', async () => {
    mockViewport.studyUIDs = ['A'];
    await renderPanel();
    act(() => mockProps.model.onNext());
    expect(screen.getByText('Step 2 of 4')).toBeTruthy();

    mockViewport.studyUIDs = ['B'];
    mockViewport.grid = [{ activeViewportId: 'v1', viewports: new Map() }, {}]; // new ref → effect re-runs
    fireEvent.click(screen.getByTitle('Endpoint Settings')); // force a re-render
    await act(async () => {
      await jest.advanceTimersByTimeAsync(200);
    });
    expect(screen.getByTestId('step-model')).toBeTruthy(); // wizard reset to step 1
  });
});

describe('AIRoutingPanel — send & reset', () => {
  it('sends selected series to AI from the confirm step with computed props', async () => {
    const sm = await renderPanel({ displaySets: [ds({ SeriesInstanceUID: 's1' })] });
    act(() => mockProps.model.onNext());
    act(() => mockProps.series.onNext());
    expect(screen.getByTestId('step-confirm')).toBeTruthy();
    expect(mockProps.confirm.selectedSeriesCount).toBe(1);
    expect(typeof mockProps.confirm.studyDescription).toBe('string');

    await act(async () => {
      await mockProps.confirm.onSend();
    });
    const [studyArg, seriesArg] = sm.services.orthancAIService.routeSeriesToAI.mock.calls[0];
    expect(studyArg).toBe('1.2.3');
    expect(seriesArg).toContain('s1');
  });

  it('drives the manifest input-mapping flow and sends mapping + config', async () => {
    const sm = await renderPanel({ displaySets: [ds({ SeriesInstanceUID: 's1' })] });
    act(() => mockProps.model.onManifestLoaded(MANIFEST));
    act(() => mockProps.model.onNext()); // → step 2 mode
    act(() => mockProps.mode.onSelectConfig('c1'));
    act(() => mockProps.mode.onNext()); // → step 3 mapping
    expect(screen.getByTestId('step-mapping')).toBeTruthy();
    act(() => mockProps.mapping.onSetInputSeries('t1', 's1')); // satisfies required input
    act(() => mockProps.mapping.onNext()); // → step 4 confirm (with mapping)

    expect(mockProps.confirm.inputMappingDescription).toBeTruthy();
    await act(async () => {
      await mockProps.confirm.onSend();
    });
    const call = sm.services.orthancAIService.routeSeriesToAI.mock.calls[0];
    expect(call[0]).toBe('1.2.3');
    expect(call[1]).toEqual(['s1']);
    expect(call[2]).toEqual({ t1: 's1' });
    expect(call[3]).toBe('c1');
  });

  it('resets back to step 1 from the progress step', async () => {
    await renderPanel({ displaySets: [ds({ SeriesInstanceUID: 's1' })] });
    act(() => mockProps.model.onNext());
    act(() => mockProps.series.onNext());
    await act(async () => {
      await mockProps.confirm.onSend();
    });
    expect(screen.getByTestId('step-progress')).toBeTruthy();
    act(() => mockProps.progress.onReset());
    expect(screen.getByTestId('step-model')).toBeTruthy();
  });

  it('stops workitem polling on unmount', async () => {
    const sm = makeServices();
    const { unmount } = render(<AIRoutingPanel servicesManager={sm as any} />);
    await act(async () => {
      await jest.advanceTimersByTimeAsync(200);
    });
    unmount();
    expect(sm.services.orthancAIService.stopWorkitemPolling).toHaveBeenCalled();
  });
});

/**
 * The gear in the panel header is available on EVERY step, while
 * `ModelSelectionStep` — which owned the manifest invalidation — is mounted only
 * on step 1. So switching model from the gear on step 4 kept model A's manifest,
 * and Send posted model B's `target`/`target_url` with A's
 * `input_configuration_id` and A's role keys. `ConfirmStep` reads the model name
 * from `currentEndpoint`, so it correctly displayed B: nothing shown to the user
 * revealed the mismatch.
 */
describe('AIRoutingPanel — changing the model invalidates what hangs off it', () => {
  const OTHER_ENDPOINT = { id: 'ep-b', name: 'Model B', url: 'http://model-b:8042' };

  /** Walk to step 4 with MANIFEST loaded and its one required input mapped. */
  const reachConfirmWithMapping = async () => {
    const sm = await renderPanel({ displaySets: [ds({ SeriesInstanceUID: 's1' })] });
    act(() => mockProps.model.onManifestLoaded(MANIFEST));
    act(() => mockProps.model.onNext());
    act(() => mockProps.mode.onSelectConfig('c1'));
    act(() => mockProps.mode.onNext());
    act(() => mockProps.mapping.onSetInputSeries('t1', 's1'));
    act(() => mockProps.mapping.onNext());
    expect(screen.getByTestId('step-confirm')).toBeTruthy();
    return sm;
  };

  /** Switch the endpoint through the header gear, as a reader would. */
  const switchModelViaGear = (endpoint: typeof OTHER_ENDPOINT) => {
    fireEvent.click(screen.getByTitle('Endpoint Settings'));
    act(() => mockProps.endpointConfig.onEndpointChange(endpoint));
    fireEvent.click(screen.getByLabelText('Close endpoint settings'));
  };

  it('returns to model selection instead of leaving the reader on confirm', async () => {
    await reachConfirmWithMapping();

    switchModelViaGear(OTHER_ENDPOINT);

    expect(screen.getByTestId('step-model')).toBeTruthy();
    expect(mockProps.model.manifest).toBeNull();
  });

  it('adopts the new endpoint on the service', async () => {
    const sm = await reachConfirmWithMapping();

    switchModelViaGear(OTHER_ENDPOINT);

    expect(sm.services.orthancAIService.setCurrentEndpoint).toHaveBeenCalledWith(OTHER_ENDPOINT);
    expect(sm.services.orthancAIService.clearManifestCache).toHaveBeenCalled();
  });

  it('cannot send model A’s input_configuration_id to model B', async () => {
    const sm = await reachConfirmWithMapping();

    switchModelViaGear(OTHER_ENDPOINT);

    // Nothing was sent, and the wizard is back where the manifest is re-read.
    expect(sm.services.orthancAIService.routeSeriesToAI).not.toHaveBeenCalled();
    expect(screen.getByTestId('step-model')).toBeTruthy();

    // Walk forward again: with no manifest for B, this is the flat 4-step flow,
    // and the payload carries no mapping and no configuration id.
    act(() => mockProps.model.onNext());
    act(() => mockProps.series.onNext());
    await act(async () => {
      await mockProps.confirm.onSend();
    });

    const call = sm.services.orthancAIService.routeSeriesToAI.mock.calls[0];
    expect(call[2]).toBeUndefined();
    expect(call[3]).toBeUndefined();
  });

  // The manifest hangs off the model — id and target url. Relabelling an endpoint
  // in the settings dialog changes neither, and resetting for it would discard a
  // role mapping the reader had already completed.
  it('keeps the wizard and the mapping when only the display name changed', async () => {
    const sm = await reachConfirmWithMapping();

    switchModelViaGear({ ...AI_ENDPOINT, name: 'MST (staging label)' });

    expect(screen.getByTestId('step-confirm')).toBeTruthy();
    expect(mockProps.confirm.inputMappingDescription).toBeTruthy();
    expect(sm.services.orthancAIService.clearManifestCache).not.toHaveBeenCalled();

    // And the relabelled endpoint is still adopted.
    expect(sm.services.orthancAIService.setCurrentEndpoint).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'MST (staging label)' })
    );

    // The send still carries the mapping it was built with.
    await act(async () => {
      await mockProps.confirm.onSend();
    });
    const call = sm.services.orthancAIService.routeSeriesToAI.mock.calls[0];
    expect(call[2]).toEqual({ t1: 's1' });
    expect(call[3]).toBe('c1');
  });

  it('applies the same invalidation when the change comes from step 1', async () => {
    const sm = await renderPanel({ displaySets: [ds({ SeriesInstanceUID: 's1' })] });
    act(() => mockProps.model.onManifestLoaded(MANIFEST));
    expect(screen.getByText('Step 1 of 5')).toBeTruthy();

    act(() => mockProps.model.onEndpointChange(OTHER_ENDPOINT));

    expect(mockProps.model.manifest).toBeNull();
    expect(screen.getByText('Step 1 of 4')).toBeTruthy();
    expect(sm.services.orthancAIService.setCurrentEndpoint).toHaveBeenCalledWith(OTHER_ENDPOINT);
  });
});
