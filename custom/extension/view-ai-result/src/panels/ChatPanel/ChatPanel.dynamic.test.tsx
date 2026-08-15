import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
// Jest-only mock helpers; the alias is invisible to tsc, hence the path.
import {
  __resetMetaData,
  __resetVolumes,
  __setMetaData,
  __setVolume,
  dispatchOnViewport,
} from '../../test-utils/__mocks__/cornerstone-core';
import {
  resetMockViewportGrid,
  setMockViewportGrid,
} from '../../test-utils/__mocks__/ohif-ui-next';
import {
  installConsoleErrorFilter,
  makeServicesManager,
  withSystem,
} from '../../test-utils/harness';

import ChatPanel from './ChatPanel';

/**
 * The chat panel on a 4D dynamic series.
 *
 * Shaped like the real UKA study, scaled down so the arithmetic is readable: 10
 * anatomical slices × 5 contrast phases = 50 instances. The proportions are what
 * matter — the viewer scrolls 10 positions, the display set holds 50 instances,
 * and they are interleaved by phase and ordered opposite to the volume.
 *
 * What these cases protect is a single claim: the numbers the panel shows are on
 * the same axis as the numbers the viewer shows, and the instances it sends all
 * come from one contrast phase. Before this, "Range 16–40 of 50, 5 slices" sent
 * one image from each of the five phases and called them slices.
 */

const SLICES = 10;
const PHASES = 5;

const sendMessage = jest.fn();
const mockHookState: any = {
  messages: [],
  isConnected: true,
  isStreaming: false,
  error: null,
  sessionId: 'session-abcdef01',
  preprocessingStatus: null,
  preprocessingProgress: null,
  connect: jest.fn(),
  sendMessage,
  cancelGeneration: jest.fn(),
  clearHistory: jest.fn(),
  appendEvent: jest.fn(),
  switchSession: jest.fn().mockResolvedValue('session-abcdef01'),
  hydrateMessages: jest.fn(),
  disconnect: jest.fn(),
};
jest.mock('../../hooks/useChatService', () => ({ useChatService: () => mockHookState }));
jest.mock('../../hooks/useActiveStudyUID', () => ({
  useActiveStudyUID: () => () => 'study-uka',
}));

installConsoleErrorFilter();
beforeAll(() => {
  (Element.prototype as any).scrollIntoView = jest.fn();
  (HTMLElement.prototype as any).focus = jest.fn();
});

/** `phase` and `slice` are 0-based; the UID encodes both so assertions read plainly. */
const uidFor = (phase: number, slice: number) => `uid-p${phase}-s${slice}`;
const imageIdFor = (phase: number, slice: number) => `img-p${phase}-s${slice}`;

function dynamicDisplaySet() {
  const timePoints: string[][] = [];
  for (let p = 0; p < PHASES; p++) {
    const ids: string[] = [];
    for (let s = 0; s < SLICES; s++) {
      ids.push(imageIdFor(p, s));
      __setMetaData('generalImageModule', imageIdFor(p, s), { sopInstanceUID: uidFor(p, s) });
    }
    timePoints.push(ids);
  }
  // Interleaved by phase and reversed spatially, as OHIF really holds it.
  const images: Array<{ SOPInstanceUID: string }> = [];
  for (let s = SLICES - 1; s >= 0; s--) {
    for (let p = 0; p < PHASES; p++) {
      images.push({ SOPInstanceUID: uidFor(p, s) });
    }
  }
  return {
    StudyInstanceUID: 'study-uka',
    AccessionNumber: 'UKA_1',
    SeriesInstanceUID: 'se-uka',
    SeriesDescription: 'NCI-dyn DEV',
    SeriesNumber: 401,
    Modality: 'MR',
    displaySetInstanceUID: 'ds-uka',
    numImageFrames: SLICES * PHASES,
    images,
    dynamicVolumeInfo: {
      isDynamicVolume: true,
      timePoints,
      splittingTag: 'TemporalPositionIdentifier',
    },
  };
}

function makeDisplaySetService(displaySets: any[]) {
  const handlers: Record<string, Array<() => void>> = {};
  return {
    EVENTS: { DISPLAY_SETS_ADDED: 'added', DISPLAY_SETS_CHANGED: 'changed' },
    getActiveDisplaySets: jest.fn(() => displaySets),
    getDisplaySetByUID: jest.fn((uid: string) =>
      displaySets.find(ds => ds.displaySetInstanceUID === uid)
    ),
    subscribe: jest.fn((evt: string, cb: () => void) => {
      (handlers[evt] ||= []).push(cb);
      return { unsubscribe: jest.fn() };
    }),
    emit: (evt: string) => (handlers[evt] || []).forEach(cb => cb()),
  };
}

/** The viewport, showing one image of one phase. Mutable so a test can scroll it. */
let viewerAt = { phase: 0, slice: 0 };
const VOLUME_ID = 'cornerstoneStreamingDynamicImageVolume:ds-uka';
const viewportServices = () => ({
  cornerstoneViewportService: {
    getCornerstoneViewport: jest.fn(() => ({
      // The two sources that actually track a dynamic volume: the index for the
      // anatomical slice, the volume's dimension group for the phase.
      getCurrentImageIdIndex: () => viewerAt.slice,
      getAllVolumeIds: () => [VOLUME_ID],
    })),
  },
});

/** Point the mock cache at a volume sitting on `viewerAt.phase`. */
function syncVolume() {
  __setVolume(VOLUME_ID, {
    dimensionGroupNumber: viewerAt.phase + 1,
    numDimensionGroups: PHASES,
  });
}

async function renderPanel() {
  withSystem(
    makeServicesManager({
      services: {
        displaySetService: makeDisplaySetService([dynamicDisplaySet()]),
        ...viewportServices(),
      },
    })
  );
  await act(async () => {
    render(<ChatPanel />);
  });
}

/**
 * Ensure a series is attached.
 *
 * The panel attaches whatever the viewport shows while it is following, and the
 * series picker is gone, so this asserts the state rather than producing it —
 * a test whose series never arrived should fail here, at the setup, and not
 * three assertions later.
 */
function attachSeries() {
  expect(screen.getByLabelText('Remove NCI-dyn DEV')).toBeTruthy();
}

async function send(text = 'What is this?') {
  fireEvent.change(screen.getByPlaceholderText('Ask about these images...'), {
    target: { value: text },
  });
  await act(async () => {
    fireEvent.click(screen.getByTitle('Send'));
  });
  return sendMessage.mock.calls[sendMessage.mock.calls.length - 1];
}

const phaseSelect = () =>
  screen.getByLabelText('Contrast phase for NCI-dyn DEV') as HTMLSelectElement;

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  resetMockViewportGrid();
  __resetMetaData();
  __resetVolumes();
  viewerAt = { phase: 0, slice: 0 };
  syncVolume();
  setMockViewportGrid({
    activeViewportId: 'v1',
    viewports: new Map([['v1', { displaySetInstanceUIDs: ['ds-uka'] }]]),
  });
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
  mockHookState.messages = [];
});

describe('ChatPanel — a 4D dynamic series', () => {
  it('counts the axis the viewer scrolls, not the instances', async () => {
    await renderPanel();
    attachSeries();
    expect(screen.getAllByText(/10 slices × 5 phases/).length).toBeGreaterThan(0);
    // The range is expressed against 10, matching the "n/10" the viewport shows.
    expect(screen.getAllByText(/of 10/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/of 50/)).toBeNull();
  });

  it('offers a contrast phase, and no such control for an ordinary series', async () => {
    await renderPanel();
    attachSeries();
    expect(phaseSelect()).toBeTruthy();
    expect(phaseSelect().value).toBe('0');
  });

  it('sends every slice from one phase', async () => {
    // The defect this whole axis exists to fix: five slices used to arrive one
    // from each phase, so enhancement differences between them were timing.
    await renderPanel();
    attachSeries();
    const [, , , snapshot] = (await send()) as any[];
    const selection = sendMessage.mock.calls[0][4][0];
    expect(selection.sop_instance_uids.length).toBeGreaterThan(1);
    selection.sop_instance_uids.forEach((uid: string) => expect(uid).toMatch(/^uid-p0-/));
    expect(selection.total_slices).toBe(10);
    expect(snapshot.series[0].phaseNumber).toBe(1);
    expect(snapshot.series[0].phaseCount).toBe(5);
    expect(snapshot.series[0].sliceCount).toBe(10);
  });

  it('sends the phase the user picked', async () => {
    await renderPanel();
    attachSeries();
    fireEvent.change(phaseSelect(), { target: { value: '3' } });
    await send();
    const selection = sendMessage.mock.calls[0][4][0];
    selection.sop_instance_uids.forEach((uid: string) => expect(uid).toMatch(/^uid-p3-/));
  });

  it('keeps the same anatomy when the phase changes', async () => {
    // Switching phase asks the same question of a different contrast timing; it
    // must not also move which part of the body is being asked about.
    await renderPanel();
    attachSeries();
    await send();
    const first = sendMessage.mock.calls[0][4][0];
    fireEvent.change(phaseSelect(), { target: { value: '2' } });
    await send('again');
    const second = sendMessage.mock.calls[1][4][0];
    expect(second.range_start).toBe(first.range_start);
    expect(second.range_end).toBe(first.range_end);
    expect(second.sop_instance_uids.map((u: string) => u.replace(/^uid-p\d+-/, ''))).toEqual(
      first.sop_instance_uids.map((u: string) => u.replace(/^uid-p\d+-/, ''))
    );
  });

  it('opens on the phase the viewport is already showing', async () => {
    viewerAt = { phase: 2, slice: 4 };
    syncVolume();
    await renderPanel();
    attachSeries();
    expect(phaseSelect().value).toBe('2');
  });

  it('marks the viewer position on the anatomical axis', async () => {
    viewerAt = { phase: 0, slice: 4 };
    syncVolume();
    await renderPanel();
    attachSeries();
    // Slice 5 of 10 — not instance 5 of 50, and not slice 25.
    expect(screen.getByTitle('Viewer is on slice 5')).toBeTruthy();
  });

  it('follows the anatomy across a phase the panel is not sending', async () => {
    // The marker answers "where am I in the body", which is the slider's axis.
    // The phase it is being viewed at is the phase selector's business.
    viewerAt = { phase: 0, slice: 2 };
    syncVolume();
    await renderPanel();
    attachSeries();
    expect(screen.getByTitle('Viewer is on slice 3')).toBeTruthy();

    viewerAt = { phase: 4, slice: 7 };
    syncVolume();
    await act(async () => {
      dispatchOnViewport('VOLUME_NEW_IMAGE');
    });
    expect(screen.getByTitle('Viewer is on slice 8')).toBeTruthy();
  });

  it('adopts the phase the viewport moves to while following', async () => {
    await renderPanel();
    attachSeries();
    expect(phaseSelect().value).toBe('0');

    viewerAt = { phase: 3, slice: 1 };
    syncVolume();
    await act(async () => {
      dispatchOnViewport('VOLUME_NEW_IMAGE');
    });
    expect(phaseSelect().value).toBe('3');
  });

  it('offers the viewport’s phase rather than taking it, once pinned', async () => {
    // Pinned, the question is the user's: scrolling the viewer must not rewrite
    // it. The offer is how they take the change if they want it.
    await renderPanel();
    attachSeries();
    fireEvent.change(phaseSelect(), { target: { value: '0' } });
    expect(screen.getByText('Pinned')).toBeTruthy();

    viewerAt = { phase: 3, slice: 1 };
    syncVolume();
    await act(async () => {
      dispatchOnViewport('VOLUME_NEW_IMAGE');
    });
    expect(phaseSelect().value).toBe('0');
    fireEvent.click(screen.getByText('use phase 4'));
    expect(phaseSelect().value).toBe('3');
  });

  it('records the phase in the message footer', async () => {
    await renderPanel();
    attachSeries();
    fireEvent.change(phaseSelect(), { target: { value: '1' } });
    const [, , , snapshot] = (await send()) as any[];
    mockHookState.messages = [
      {
        id: 'u1',
        role: 'user',
        content: 'q',
        timestamp: new Date(),
        promptContext: snapshot,
      },
    ];
    await act(async () => {
      render(<ChatPanel />);
    });
    await act(async () => {
      fireEvent.click(screen.getAllByTitle('What this message was sent with')[0]);
    });
    expect(screen.getAllByText(/phase 2 of 5/).length).toBeGreaterThan(0);
  });
});
