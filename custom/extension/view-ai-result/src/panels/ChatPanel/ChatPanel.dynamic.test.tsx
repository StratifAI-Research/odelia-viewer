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

/**
 * The viewport, showing one image of one phase. Mutable so a test can scroll it.
 *
 * `normal` and `stepCount` stand in for the reader picking sagittal or coronal
 * from the viewport's orientation menu: the camera then looks down a different
 * axis, and the viewport counts steps along one of a different length.
 */
let viewerAt: {
  phase: number;
  slice: number;
  /** Steps the viewport scrolls through. Differs from SLICES on a reformat. */
  stepCount?: number;
  /** The camera's view normal. The acquisition one, unless a test reorients. */
  normal?: [number, number, number];
} = { phase: 0, slice: 0 };

/**
 * The acquisition normal for the fixture's volume direction below: cornerstone
 * derives it as the negated third row of the direction matrix.
 */
const ACQUISITION_NORMAL: [number, number, number] = [0, 0, -1];
const VOLUME_ID = 'cornerstoneStreamingDynamicImageVolume:ds-uka';
const viewportServices = () => ({
  cornerstoneViewportService: {
    getCornerstoneViewport: jest.fn(() => ({
      // The two sources that actually track a dynamic volume: the index for the
      // anatomical slice, the volume's dimension group for the phase.
      getCurrentImageIdIndex: () => viewerAt.slice,
      getAllVolumeIds: () => [VOLUME_ID],
      getCamera: () => ({ viewPlaneNormal: viewerAt.normal ?? ACQUISITION_NORMAL }),
      getNumberOfSlices: () => viewerAt.stepCount ?? SLICES,
    })),
  },
});

/** Point the mock cache at a volume sitting on `viewerAt.phase`. */
function syncVolume() {
  __setVolume(VOLUME_ID, {
    dimensionGroupNumber: viewerAt.phase + 1,
    numDimensionGroups: PHASES,
    // Identity orientation, so the acquisition normal is [0, 0, -1].
    direction: [1, 0, 0, 0, 1, 0, 0, 0, 1],
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

const groupSelect = () =>
  screen.getByLabelText('temporal position for NCI-dyn DEV') as HTMLSelectElement;

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
    expect(screen.getAllByText(/10 slices × 5 temporal positions/).length).toBeGreaterThan(0);
    // The range is expressed against 10, matching the "n/10" the viewport shows.
    expect(screen.getAllByText(/of 10/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/of 50/)).toBeNull();
  });

  it('offers a temporal position selector, and none for an ordinary series', async () => {
    await renderPanel();
    attachSeries();
    expect(groupSelect()).toBeTruthy();
    expect(groupSelect().value).toBe('0');
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
    expect(snapshot.series[0].dimensionGroupNumber).toBe(1);
    expect(snapshot.series[0].dimensionGroupCount).toBe(5);
    expect(snapshot.series[0].splittingTag).toBe('TemporalPositionIdentifier');
    expect(snapshot.series[0].sliceCount).toBe(10);
  });

  it('sends the phase the user picked', async () => {
    await renderPanel();
    attachSeries();
    fireEvent.change(groupSelect(), { target: { value: '3' } });
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
    fireEvent.change(groupSelect(), { target: { value: '2' } });
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
    expect(groupSelect().value).toBe('2');
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
    expect(groupSelect().value).toBe('0');

    viewerAt = { phase: 3, slice: 1 };
    syncVolume();
    await act(async () => {
      dispatchOnViewport('VOLUME_NEW_IMAGE');
    });
    expect(groupSelect().value).toBe('3');
  });

  it('holds the phase when the viewport stops reporting one', async () => {
    // `useViewerSlice` reports an unknown dimension group as null precisely so it
    // is not guessed, and a dynamic series shown in a stack viewport reports none
    // at all, permanently. Following used to read that null as group 1, so the
    // panel claimed to follow a reader on phase 4 while sending phase 1.
    await renderPanel();
    attachSeries();

    // Following, the viewport moves to phase 4 and the panel adopts it.
    viewerAt = { phase: 3, slice: 1 };
    syncVolume();
    await act(async () => {
      dispatchOnViewport('VOLUME_NEW_IMAGE');
    });
    expect(groupSelect().value).toBe('3');

    // Now the volume stops reporting a group, while the viewport goes on
    // reporting a slice. Its orientation is still there: this is about the group
    // being unknown, not the axis.
    __setVolume(VOLUME_ID, { direction: [1, 0, 0, 0, 1, 0, 0, 0, 1] });
    viewerAt = { phase: 3, slice: 5 };
    await act(async () => {
      dispatchOnViewport('VOLUME_NEW_IMAGE');
    });

    // The slice still follows; the phase holds rather than silently becoming the
    // first, which the panel would then have described as following the viewer.
    expect(screen.getByTitle('Viewer is on slice 6')).toBeTruthy();
    expect(groupSelect().value).toBe('3');
  });

  it('offers the viewport’s phase rather than taking it, once pinned', async () => {
    // Pinned, the question is the user's: scrolling the viewer must not rewrite
    // it. The offer is how they take the change if they want it.
    await renderPanel();
    attachSeries();
    fireEvent.change(groupSelect(), { target: { value: '0' } });
    expect(screen.getByText('Pinned')).toBeTruthy();

    viewerAt = { phase: 3, slice: 1 };
    syncVolume();
    await act(async () => {
      dispatchOnViewport('VOLUME_NEW_IMAGE');
    });
    expect(groupSelect().value).toBe('0');
    fireEvent.click(screen.getByText('use temporal position 4'));
    expect(groupSelect().value).toBe('3');
  });

  it('says when the selected position is not the viewer’s', async () => {
    // A series has to open on some position, and the panel says it follows the
    // viewer. If the viewport cannot report which one it is showing, a reader
    // would otherwise read the selector as tracked when it is a default. A stack
    // viewport of a dynamic series reports none at all, permanently, so this is
    // not a flicker during load.
    __setVolume(VOLUME_ID, { direction: [1, 0, 0, 0, 1, 0, 0, 0, 1] });
    await renderPanel();
    attachSeries();

    expect(screen.getByText('(not the viewer’s)')).toBeTruthy();

    // Once the viewport can say, the note goes and the value is the viewer's.
    viewerAt = { phase: 2, slice: 1 };
    syncVolume();
    await act(async () => {
      dispatchOnViewport('VOLUME_NEW_IMAGE');
    });
    expect(screen.queryByText('(not the viewer’s)')).toBeNull();
    expect(groupSelect().value).toBe('2');
  });

  describe('a reoriented viewport', () => {
    // A slice axis is the ACQUISITION axis. A volume viewport counts steps along
    // whatever its camera looks down, and OHIF offers sagittal and coronal on any
    // reconstructable series — which a dynamic study always is, since it is
    // upgraded to a volume viewport to be shown at all. Reoriented, step 250 of a
    // ~512-step sagittal scroll read against a 10-slice axis clamps to 10, so the
    // prompt would sit on the last slice through nearly the whole scroll while
    // saying it follows the viewer.

    it('stops following, and says so', async () => {
      await renderPanel();
      attachSeries();
      viewerAt = { phase: 0, slice: 3 };
      await act(async () => {
        dispatchOnViewport('STACK_NEW_IMAGE');
      });
      expect(screen.getByText('Follows viewer')).toBeTruthy();
      const rangeStart = () =>
        (screen.getByLabelText('First slice of NCI-dyn DEV') as HTMLInputElement).value;
      const followed = rangeStart();
      expect(followed).not.toBe('10');

      // The reader switches to sagittal: a different axis, 512 steps long.
      viewerAt = { phase: 0, slice: 250, stepCount: 512, normal: [-1, 0, 0] };
      await act(async () => {
        dispatchOnViewport('STACK_NEW_IMAGE');
      });

      expect(screen.getByText('Not following this view')).toBeTruthy();
      // The range is the last one the reader actually chose, not clamped to the
      // end of an axis the viewer is no longer scrolling.
      expect(rangeStart()).toBe(followed);
      // And the "you are here" marker is gone rather than pointing at a position
      // that means nothing on this axis.
      expect(screen.queryByTitle(/Viewer is on slice/)).toBeNull();
    });

    it('does not seed a range from it either', async () => {
      // Opening the panel on an already-reoriented viewport. The seeding effect
      // runs before anything has been followed, so guarding only the follow
      // effect would let the bad number in and then faithfully preserve it.
      viewerAt = { phase: 0, slice: 250, stepCount: 512, normal: [-1, 0, 0] };
      await renderPanel();
      attachSeries();

      expect(screen.getByText('Not following this view')).toBeTruthy();
      // Seeded from the configured recipe, not clamped to the end of an axis the
      // viewer is not on.
      const start = (screen.getByLabelText('First slice of NCI-dyn DEV') as HTMLInputElement).value;
      expect(start).not.toBe(String(SLICES));
    });

    it('goes on following the temporal position, which has no orientation', async () => {
      // Which position on the fourth axis is on screen is not a spatial
      // question. Freezing it along with the range would stop the panel
      // following something it still can.
      await renderPanel();
      attachSeries();
      viewerAt = { phase: 0, slice: 250, stepCount: 512, normal: [-1, 0, 0] };
      syncVolume();
      await act(async () => {
        dispatchOnViewport('VOLUME_NEW_IMAGE');
      });
      expect(screen.getByText('Not following this view')).toBeTruthy();

      viewerAt = { ...viewerAt, phase: 3 };
      syncVolume();
      await act(async () => {
        dispatchOnViewport('VOLUME_NEW_IMAGE');
      });

      expect(groupSelect().value).toBe('3');
    });

    it('stops when the same plane is looked at from the other side', async () => {
      // The plane alone is not the question: a flipped normal is the same plane
      // with the same step count and the index running backwards, so every slice
      // number would be wrong by more than a reformat's would.
      await renderPanel();
      attachSeries();
      expect(screen.getByText('Follows viewer')).toBeTruthy();

      viewerAt = { phase: 0, slice: 3, normal: [0, 0, 1] };
      await act(async () => {
        dispatchOnViewport('VOLUME_NEW_IMAGE');
      });

      expect(screen.getByText('Not following this view')).toBeTruthy();
    });

    it('notices an orientation change that moves no slice', async () => {
      // Reorienting moves the camera; the slice index need not change with it,
      // and cornerstone suppresses the new-image event when it does not. Watching
      // only for new images would leave "Follows viewer" standing until the
      // reader happened to scroll.
      await renderPanel();
      attachSeries();
      expect(screen.getByText('Follows viewer')).toBeTruthy();

      viewerAt = { ...viewerAt, normal: [-1, 0, 0], stepCount: 512 };
      await act(async () => {
        dispatchOnViewport('CAMERA_MODIFIED');
      });

      expect(screen.getByText('Not following this view')).toBeTruthy();
    });

    it('stops on a shallow oblique that would render as the acquisition plane', async () => {
      // Cornerstone's own `isInAcquisitionPlane` allows 8 degrees, which is the
      // right tolerance for "near enough to draw as axial" and the wrong one for
      // "this index addresses acquisition slices". Five degrees off is a
      // different set of voxels under every pixel.
      await renderPanel();
      attachSeries();
      expect(screen.getByText('Follows viewer')).toBeTruthy();

      viewerAt = { phase: 0, slice: 3, normal: [0.0871557, 0, -0.9961947] };
      await act(async () => {
        dispatchOnViewport('CAMERA_MODIFIED');
      });

      expect(screen.getByText('Not following this view')).toBeTruthy();
    });

    it('reads a Float32Array direction, which is what cornerstone really holds', async () => {
      // `direction` is a Mat3 and may be a typed array; the helper preserves the
      // container. An `Array.isArray` test would quietly answer "unknown" on
      // exactly the viewports this guard exists for.
      await renderPanel();
      attachSeries();
      __setVolume(VOLUME_ID, {
        dimensionGroupNumber: 1,
        numDimensionGroups: PHASES,
        direction: new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]),
      });

      // Asserted the way round that can tell the difference: reading the typed
      // array correctly means recognising the acquisition axis and FOLLOWING it.
      // A test that expected "not following" would pass either way, since a
      // check that cannot read the normal also refuses.
      viewerAt = { phase: 0, slice: 3 };
      await act(async () => {
        dispatchOnViewport('CAMERA_MODIFIED');
      });
      expect(screen.getByText('Follows viewer')).toBeTruthy();

      viewerAt = { phase: 0, slice: 3, normal: [-1, 0, 0] };
      await act(async () => {
        dispatchOnViewport('CAMERA_MODIFIED');
      });
      expect(screen.getByText('Not following this view')).toBeTruthy();
    });

    it('does not follow a volume viewport whose volume it cannot read', async () => {
      // The step count is no help there either: cornerstone computes it from the
      // same cached volume, so both go silent together and the panel would be
      // following on nothing at all.
      await renderPanel();
      attachSeries();
      expect(screen.getByText('Follows viewer')).toBeTruthy();

      __resetVolumes();
      await act(async () => {
        dispatchOnViewport('CAMERA_MODIFIED');
      });

      expect(screen.getByText('Not following this view')).toBeTruthy();
    });

    it('resumes when the viewport goes back to the acquisition view', async () => {
      await renderPanel();
      attachSeries();
      viewerAt = { phase: 0, slice: 250, stepCount: 512, normal: [-1, 0, 0] };
      await act(async () => {
        dispatchOnViewport('STACK_NEW_IMAGE');
      });
      expect(screen.getByText('Not following this view')).toBeTruthy();

      viewerAt = { phase: 0, slice: 7 };
      await act(async () => {
        dispatchOnViewport('STACK_NEW_IMAGE');
      });

      expect(screen.getByText('Follows viewer')).toBeTruthy();
      expect(screen.getByTitle('Viewer is on slice 8')).toBeTruthy();
    });

    it('stops on the plane alone, when the step count happens to agree', async () => {
      // A reformat of a near-isotropic volume can come out the same length as
      // the acquisition axis by coincidence, and a matching count is not a
      // matching axis. The plane is the direct question; the count is only there
      // to catch what the plane test, being sign-insensitive, would let through.
      await renderPanel();
      attachSeries();
      viewerAt = { phase: 0, slice: 3 };
      await act(async () => {
        dispatchOnViewport('STACK_NEW_IMAGE');
      });
      expect(screen.getByText('Follows viewer')).toBeTruthy();

      viewerAt = { phase: 0, slice: 3, normal: [-1, 0, 0] };
      await act(async () => {
        dispatchOnViewport('STACK_NEW_IMAGE');
      });

      expect(screen.getByText('Not following this view')).toBeTruthy();
    });

    it('stops on a step count that cannot be this axis, whatever the plane says', async () => {
      // The plane test is sign-insensitive, so the step count is carried
      // alongside it: a length that cannot be the acquisition axis proves a
      // mismatch on its own.
      await renderPanel();
      attachSeries();
      viewerAt = { phase: 0, slice: 3 };
      await act(async () => {
        dispatchOnViewport('STACK_NEW_IMAGE');
      });
      expect(screen.getByText('Follows viewer')).toBeTruthy();

      viewerAt = { phase: 0, slice: 250, stepCount: 512 };
      await act(async () => {
        dispatchOnViewport('STACK_NEW_IMAGE');
      });

      expect(screen.getByText('Not following this view')).toBeTruthy();
    });
  });

  it('never calls a b-value a phase', async () => {
    // Cornerstone splits a 4D series on the first of TemporalPositionIdentifier,
    // a b-value, an echo or a trigger time that separates it. None of them says
    // anything about contrast, and a panel that called a diffusion b-value a
    // phase would be asserting a clinical fact about the images that nothing in
    // them supports.
    const diffusion = dynamicDisplaySet();
    diffusion.dynamicVolumeInfo.splittingTag = 'DiffusionBValue';
    withSystem(
      makeServicesManager({
        services: {
          displaySetService: makeDisplaySetService([diffusion]),
          ...viewportServices(),
        },
      })
    );
    syncVolume();
    await act(async () => {
      render(<ChatPanel />);
    });
    attachSeries();

    expect(screen.getByLabelText('b-value for NCI-dyn DEV')).toBeTruthy();
    expect(screen.queryByLabelText('temporal position for NCI-dyn DEV')).toBeNull();
    expect(screen.getAllByText(/10 slices × 5 b-values/).length).toBeGreaterThan(0);

    const [, , , snapshot] = (await send()) as any[];
    expect(snapshot.series[0].splittingTag).toBe('DiffusionBValue');
    mockHookState.messages = [
      { id: 'm1', role: 'user', content: 'q', timestamp: new Date(), promptContext: snapshot },
    ];
    await act(async () => {
      render(<ChatPanel />);
    });
    await act(async () => {
      fireEvent.click(screen.getAllByTitle('What this message was sent with')[0]);
    });
    expect(screen.getAllByText(/b-value 1 of 5/).length).toBeGreaterThan(0);
  });

  it('records the phase in the message footer', async () => {
    await renderPanel();
    attachSeries();
    fireEvent.change(groupSelect(), { target: { value: '1' } });
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
    expect(screen.getAllByText(/temporal position 2 of 5/).length).toBeGreaterThan(0);
  });
});
