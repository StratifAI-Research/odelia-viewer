import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { AI_ENDPOINT } from '../test-utils/harness';

// Real useStudySeriesSelection imports @ohif/core (a UMD needing cornerstone); stub it.
jest.mock('@ohif/core', () => ({
  utils: { formatDate: (d: string) => d || '' },
  DicomMetadataStore: { getStudy: jest.fn(() => ({ series: [] })) },
}));

// Capture the props each step / child is rendered with, so we can drive the
// wizard by invoking the captured callbacks. Real hooks run underneath.
const mockProps: any = {};
jest.mock('./steps/ModelSelectionStep', () => ({
  ModelSelectionStep: (p: any) => { mockProps.model = p; return <div data-testid="step-model" />; },
}));
jest.mock('./steps/SeriesSelectionStep', () => ({
  SeriesSelectionStep: (p: any) => { mockProps.series = p; return <div data-testid="step-series" />; },
}));
jest.mock('./steps/InputModeSelectionStep', () => ({
  InputModeSelectionStep: (p: any) => { mockProps.mode = p; return <div data-testid="step-mode" />; },
}));
jest.mock('./steps/InputMappingStep', () => ({
  InputMappingStep: (p: any) => { mockProps.mapping = p; return <div data-testid="step-mapping" />; },
}));
jest.mock('./steps/EndpointSelectionStep', () => ({
  EndpointSelectionStep: (p: any) => { mockProps.confirm = p; return <div data-testid="step-confirm" />; },
}));
jest.mock('./steps/ProgressStep', () => ({
  ProgressStep: (p: any) => { mockProps.progress = p; return <div data-testid="step-progress" />; },
}));
jest.mock('./AIEndpointConfig', () => ({
  __esModule: true,
  default: (p: any) => { mockProps.endpointConfig = p; return <div data-testid="endpoint-config" />; },
}));

import AIRoutingPanel from './AIRoutingPanel';

const MANIFEST = {
  model_id: 'm',
  model_name: 'M',
  version: '1',
  input_configurations: [{ id: 'c1', name: 'cfg', inputs: [] }],
};

function ds(over: Record<string, any> = {}) {
  return {
    StudyInstanceUID: '1.2.3', // matches useImageViewer stub's StudyInstanceUIDs[0]
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
    routeSeriesToAI: jest.fn().mockResolvedValue({ status: 'success', workitem_uid: 'w1', message: 'ok' }),
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
      customizationService: { getCustomization: jest.fn(() => ({ progress }: any) => <div>{progress}</div>) },
    },
  };
}

async function renderPanel(opts = {}) {
  const sm = makeServices(opts);
  render(<AIRoutingPanel servicesManager={sm as any} />);
  await act(async () => {
    await jest.advanceTimersByTimeAsync(300); // settle study/series effects
  });
  return sm;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  for (const k of Object.keys(mockProps)) delete mockProps[k];
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('AIRoutingPanel', () => {
  it('renders the header and step 1 (ModelSelectionStep) with wired props', async () => {
    const sm = await renderPanel();
    expect(screen.getByText('AI Analysis')).toBeTruthy();
    expect(screen.getByText('Step 1 of 4')).toBeTruthy(); // no manifest → 4 steps
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
    fireEvent.click(screen.getByText('✕'));
    expect(screen.queryByTestId('endpoint-config')).toBeNull();
  });

  it('sends selected series to AI from the confirm step', async () => {
    const sm = await renderPanel({ displaySets: [ds({ SeriesInstanceUID: 's1' })] });
    // step 1 → 2 (series, auto-selected) → 3 (confirm)
    act(() => mockProps.model.onNext());
    act(() => mockProps.series.onNext());
    expect(screen.getByTestId('step-confirm')).toBeTruthy();

    await act(async () => {
      await mockProps.confirm.onSend();
    });
    const [studyArg, seriesArg] = sm.services.orthancAIService.routeSeriesToAI.mock.calls[0];
    expect(studyArg).toBe('1.2.3');
    expect(seriesArg).toContain('s1');
  });

  it('resets back to step 1 from the progress step', async () => {
    await renderPanel({ displaySets: [ds({ SeriesInstanceUID: 's1' })] });
    act(() => mockProps.model.onNext());
    act(() => mockProps.series.onNext());
    await act(async () => {
      await mockProps.confirm.onSend(); // advances to the progress step
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
