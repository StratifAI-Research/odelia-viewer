import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { eventTarget } from '@cornerstonejs/core';
// Imported by path, not through '@ohif/ui-next': the alias exists only in the
// jest moduleNameMapper, so tsc would resolve the real package and reject these
// test-only helpers. Same resolved file either way, so it is the same module.
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

// ChatPanel harness for the slice-range control. The display sets carry a real
// instance list, which is what makes a range expressible at all — the sibling
// context suite covers the opposite case, where it is not.
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
  useActiveStudyUID: () => () => 'study-1',
}));

installConsoleErrorFilter();
beforeAll(() => {
  (Element.prototype as any).scrollIntoView = jest.fn();
  (HTMLElement.prototype as any).focus = jest.fn();
});
beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  (eventTarget as any).reset();
  resetMockViewportGrid();
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
});

/** `count` instances whose UIDs encode their position, so order is checkable. */
const instances = (count: number, prefix = '1.2.840.SE1') =>
  Array.from({ length: count }, (_, i) => ({ SOPInstanceUID: `${prefix}.${i + 1}` }));

/** A 20-slice series: small enough that the arithmetic stays readable in tests. */
const ADDRESSABLE = [
  {
    StudyInstanceUID: 'study-1',
    StudyDate: '20260812',
    StudyDescription: 'Breast MRI',
    SeriesInstanceUID: 'se-1',
    SeriesDescription: 'Ax T1 post',
    SeriesNumber: 1,
    Modality: 'MR',
    numImageFrames: 20,
    images: instances(20),
  },
];

function makeDisplaySetService(displaySets: any[]) {
  return {
    EVENTS: { DISPLAY_SETS_ADDED: 'added', DISPLAY_SETS_CHANGED: 'changed' },
    getActiveDisplaySets: jest.fn(() => displaySets),
    getDisplaySetByUID: jest.fn((uid: string) =>
      displaySets.find(ds => ds.displaySetInstanceUID === uid)
    ),
    subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
  };
}

async function renderPanel(displaySets: any[] = ADDRESSABLE, extraServices: any = {}) {
  withSystem(
    makeServicesManager({
      services: { displaySetService: makeDisplaySetService(displaySets), ...extraServices },
    })
  );
  let utils: any;
  await act(async () => {
    utils = render(<ChatPanel />);
  });
  return utils;
}

/** Attach the first series, as a user would. */
function attachSeries(description = 'Ax T1 post') {
  fireEvent.click(screen.getByText('+ Add series'));
  fireEvent.click(screen.getByText(description));
}

const firstHandle = () => screen.getByLabelText('First slice of Ax T1 post') as HTMLInputElement;
const lastHandle = () => screen.getByLabelText('Last slice of Ax T1 post') as HTMLInputElement;

describe('ChatPanel — slice range', () => {
  it('offers a range control once an addressable series is attached', async () => {
    await renderPanel();
    attachSeries();
    expect(firstHandle()).toBeTruthy();
    expect(lastHandle()).toBeTruthy();
  });

  it('seeds the range from the configured central band', async () => {
    // Default recipe is central 60% — the band extract_slices already used. A
    // 20-slice series drops 20% from each end, leaving slices 5..16.
    await renderPanel();
    attachSeries();
    expect(firstHandle().value).toBe('5');
    expect(lastHandle().value).toBe('16');
    expect(screen.getByText('Range 5–16 of 20')).toBeTruthy();
  });

  it('separates the selected range from the number of slices sent', async () => {
    // The headline distinction: 12 slices selected, 5 of them sent.
    await renderPanel();
    attachSeries();
    expect(screen.getByText('Range 5–16 of 20')).toBeTruthy();
    expect(screen.getByText('5 slices sent')).toBeTruthy();
  });

  it('reports the total images the message will carry', async () => {
    await renderPanel();
    attachSeries();
    expect(screen.getByText(/Sends 5 images in total/)).toBeTruthy();
  });

  it('moves the range when a handle is dragged', async () => {
    await renderPanel();
    attachSeries();
    fireEvent.change(firstHandle(), { target: { value: '9' } });
    expect(screen.getByText('Range 9–16 of 20')).toBeTruthy();
  });

  it('does not let the handles cross', async () => {
    // A crossed range would make the sampled set empty with nothing said about it.
    await renderPanel();
    attachSeries();
    fireEvent.change(firstHandle(), { target: { value: '18' } });
    expect(screen.getByText('Range 18 of 20')).toBeTruthy();
    expect(lastHandle().value).toBe('18');
  });

  it('narrows the sent count when the range gets smaller than it', async () => {
    // 5 slices cannot come out of a 3-slice range, and the panel must not claim so.
    await renderPanel();
    attachSeries();
    fireEvent.change(firstHandle(), { target: { value: '14' } });
    expect(screen.getByText('Range 14–16 of 20')).toBeTruthy();
    expect(screen.getByText('3 slices sent')).toBeTruthy();
  });

  it('raises and lowers the sent count', async () => {
    await renderPanel();
    attachSeries();
    fireEvent.click(screen.getByLabelText('Send more slices from Ax T1 post'));
    expect(screen.getByText('6 slices sent')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Send fewer slices from Ax T1 post'));
    expect(screen.getByText('5 slices sent')).toBeTruthy();
  });

  it('will not offer to send more slices than the range holds', async () => {
    await renderPanel();
    attachSeries();
    fireEvent.change(firstHandle(), { target: { value: '15' } });
    fireEvent.change(lastHandle(), { target: { value: '16' } });
    expect(screen.getByText('2 slices sent')).toBeTruthy();
    expect(
      (screen.getByLabelText('Send more slices from Ax T1 post') as HTMLButtonElement).disabled
    ).toBe(true);
  });

  it('will not offer to send fewer than one slice', async () => {
    await renderPanel();
    attachSeries();
    const fewer = screen.getByLabelText('Send fewer slices from Ax T1 post');
    for (let i = 0; i < 6; i++) {
      fireEvent.click(fewer);
    }
    expect(screen.getByText('1 slice sent')).toBeTruthy();
    expect((fewer as HTMLButtonElement).disabled).toBe(true);
  });

  it('pins the context when the range is adjusted', async () => {
    // Adjusting the range is an investment in the prompt: a viewport change must
    // not then retarget it.
    await renderPanel();
    attachSeries();
    fireEvent.change(firstHandle(), { target: { value: '3' } });
    expect(screen.getByText('Pinned')).toBeTruthy();
  });

  it('pins the context when the sent count is adjusted', async () => {
    await renderPanel();
    attachSeries();
    fireEvent.click(screen.getByLabelText('Send more slices from Ax T1 post'));
    expect(screen.getByText('Pinned')).toBeTruthy();
  });

  describe('what is sent', () => {
    it('names the sampled instances, in order', async () => {
      await renderPanel();
      attachSeries();
      fireEvent.change(screen.getByPlaceholderText('Ask about these images...'), {
        target: { value: 'q' },
      });
      fireEvent.click(screen.getByTitle('Send'));

      const selections = sendMessage.mock.calls[0][4];
      expect(selections).toHaveLength(1);
      expect(selections[0].series_uid).toBe('se-1');
      // Range 5..16, 5 slices: span 12, step 2.75 -> slices 5, 8, 11, 13, 16.
      expect(selections[0].sop_instance_uids).toEqual([
        '1.2.840.SE1.5',
        '1.2.840.SE1.8',
        '1.2.840.SE1.11',
        '1.2.840.SE1.13',
        '1.2.840.SE1.16',
      ]);
    });

    it('sends the range as audit metadata alongside the instances', async () => {
      await renderPanel();
      attachSeries();
      fireEvent.change(screen.getByPlaceholderText('Ask about these images...'), {
        target: { value: 'q' },
      });
      fireEvent.click(screen.getByTitle('Send'));

      const selection = sendMessage.mock.calls[0][4][0];
      expect(selection.range_start).toBe(5);
      expect(selection.range_end).toBe(16);
      expect(selection.total_slices).toBe(20);
    });

    it('sends the range the user set, not the one it started with', async () => {
      await renderPanel();
      attachSeries();
      fireEvent.change(firstHandle(), { target: { value: '2' } });
      fireEvent.change(lastHandle(), { target: { value: '4' } });
      fireEvent.change(screen.getByPlaceholderText('Ask about these images...'), {
        target: { value: 'q' },
      });
      fireEvent.click(screen.getByTitle('Send'));

      const selection = sendMessage.mock.calls[0][4][0];
      expect(selection.sop_instance_uids).toEqual([
        '1.2.840.SE1.2',
        '1.2.840.SE1.3',
        '1.2.840.SE1.4',
      ]);
    });

    it('records the same slices in the message snapshot', async () => {
      // The wire payload and the snapshot are built from one state read; if they
      // could drift, the provenance footer would be a false claim.
      await renderPanel();
      attachSeries();
      fireEvent.change(screen.getByPlaceholderText('Ask about these images...'), {
        target: { value: 'q' },
      });
      fireEvent.click(screen.getByTitle('Send'));

      const snapshot = sendMessage.mock.calls[0][3];
      const selection = sendMessage.mock.calls[0][4][0];
      expect(snapshot.series[0].sentSliceNumbers).toEqual([5, 8, 11, 13, 16]);
      expect(snapshot.series[0].rangeStart).toBe(5);
      expect(snapshot.series[0].rangeEnd).toBe(16);
      expect(snapshot.requestedImageCount).toBe(selection.sop_instance_uids.length);
    });
  });

  describe('series that cannot be addressed slice by slice', () => {
    const MULTIFRAME = [
      {
        ...ADDRESSABLE[0],
        // One enhanced instance covering 40 frames: naming it cannot express a range.
        numImageFrames: 40,
        images: instances(1),
      },
    ];

    it('says a range does not apply and names the recipe instead', async () => {
      await renderPanel(MULTIFRAME);
      attachSeries();
      expect(screen.getByText(/Slice range unavailable for this series/)).toBeTruthy();
      expect(screen.getByText(/5 slices\/series/)).toBeTruthy();
    });

    it('offers no range handles at all', async () => {
      await renderPanel(MULTIFRAME);
      attachSeries();
      expect(screen.queryByLabelText('First slice of Ax T1 post')).toBeNull();
    });

    it('sends no slice selection, leaving the configured recipe in force', async () => {
      await renderPanel(MULTIFRAME);
      attachSeries();
      fireEvent.change(screen.getByPlaceholderText('Ask about these images...'), {
        target: { value: 'q' },
      });
      fireEvent.click(screen.getByTitle('Send'));
      expect(sendMessage.mock.calls[0][4]).toEqual([]);
    });

    it('records no slice numbers in the snapshot either', async () => {
      // Absence is the record that the recipe applied, so the snapshot must not
      // invent a range it did not send.
      await renderPanel(MULTIFRAME);
      attachSeries();
      fireEvent.change(screen.getByPlaceholderText('Ask about these images...'), {
        target: { value: 'q' },
      });
      fireEvent.click(screen.getByTitle('Send'));
      expect(sendMessage.mock.calls[0][3].series[0].sentSliceNumbers).toBeUndefined();
    });

    it('treats a partially loaded series as unaddressable', async () => {
      // Fewer instances than frames means slice N points at the wrong instance.
      await renderPanel([{ ...ADDRESSABLE[0], numImageFrames: 20, images: instances(7) }]);
      attachSeries();
      expect(screen.getByText(/Slice range unavailable for this series/)).toBeTruthy();
    });
  });

  describe('the viewer-slice marker', () => {
    const viewportServices = (index: number) => ({
      cornerstoneViewportService: {
        getCornerstoneViewport: jest.fn(() => ({ getCurrentImageIdIndex: () => index })),
      },
    });

    /** Point the active viewport at a display set, as the grid would. */
    const showDisplaySet = (uid: string) =>
      setMockViewportGrid({
        activeViewportId: 'v1',
        viewports: new Map([['v1', { displaySetInstanceUIDs: [uid] }]]),
      });

    it('marks where the viewport is', async () => {
      showDisplaySet('ds-1');
      await renderPanel(
        [{ ...ADDRESSABLE[0], displaySetInstanceUID: 'ds-1' }],
        viewportServices(11)
      );
      attachSeries();
      // 0-based index 11 is slice 12.
      expect(screen.getByTitle('Viewer is on slice 12')).toBeTruthy();
    });

    it('follows the viewport as it scrolls', async () => {
      showDisplaySet('ds-1');
      let index = 3;
      await renderPanel([{ ...ADDRESSABLE[0], displaySetInstanceUID: 'ds-1' }], {
        cornerstoneViewportService: {
          getCornerstoneViewport: jest.fn(() => ({ getCurrentImageIdIndex: () => index })),
        },
      });
      attachSeries();
      expect(screen.getByTitle('Viewer is on slice 4')).toBeTruthy();

      index = 9;
      await act(async () => {
        (eventTarget as any).dispatch('STACK_NEW_IMAGE');
      });
      expect(screen.getByTitle('Viewer is on slice 10')).toBeTruthy();
    });

    it('does not move the selection when the viewport scrolls', async () => {
      // The marker is orientation, not selection. Scrolling must leave the range
      // and the sent slices exactly where the user put them.
      showDisplaySet('ds-1');
      let index = 3;
      await renderPanel([{ ...ADDRESSABLE[0], displaySetInstanceUID: 'ds-1' }], {
        cornerstoneViewportService: {
          getCornerstoneViewport: jest.fn(() => ({ getCurrentImageIdIndex: () => index })),
        },
      });
      attachSeries();
      index = 19;
      await act(async () => {
        (eventTarget as any).dispatch('STACK_NEW_IMAGE');
      });
      expect(screen.getByText('Range 5–16 of 20')).toBeTruthy();
      expect(screen.getByText('5 slices sent')).toBeTruthy();
    });

    it('shows no marker when the viewport shows a different series', async () => {
      // A slice number from another acquisition would point at a position that
      // means nothing on this track.
      showDisplaySet('viewer-ds');
      await renderPanel([{ ...ADDRESSABLE[0], displaySetInstanceUID: 'other-ds' }], {
        cornerstoneViewportService: {
          getCornerstoneViewport: jest.fn(() => ({ getCurrentImageIdIndex: () => 5 })),
        },
      });
      attachSeries();
      expect(screen.queryByTitle(/Viewer is on slice/)).toBeNull();
    });

    it('shows no marker when cornerstone cannot report a position', async () => {
      showDisplaySet('ds-1');
      await renderPanel([{ ...ADDRESSABLE[0], displaySetInstanceUID: 'ds-1' }]);
      attachSeries();
      expect(screen.queryByTitle(/Viewer is on slice/)).toBeNull();
    });
  });
});
