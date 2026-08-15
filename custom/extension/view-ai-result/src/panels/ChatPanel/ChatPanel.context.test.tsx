import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
// Imported by path, not through '@ohif/ui-next': the alias exists only in the
// jest moduleNameMapper, so tsc would resolve the real package.
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

// Isolated ChatPanel harness for prompt-context behaviour: display-set refresh,
// the debug-API-base override, and the following/pinned rules. useChatService is
// stubbed; useActiveStudyUID is driven by `mockActiveStudy` so a test can move the
// viewer to another study mid-conversation.
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

let mockActiveStudy: string | null = 'study-1';
jest.mock('../../hooks/useActiveStudyUID', () => ({
  useActiveStudyUID: () => () => mockActiveStudy,
}));

installConsoleErrorFilter();
beforeAll(() => {
  (Element.prototype as any).scrollIntoView = jest.fn();
  (HTMLElement.prototype as any).focus = jest.fn();
});
beforeEach(() => {
  jest.clearAllMocks();
  // Chat threads persist in sessionStorage; clear so cases stay independent.
  window.sessionStorage.clear();
  mockActiveStudy = 'study-1';
  resetMockViewportGrid();
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
});

/** Point the active viewport at a display set, which is what attaches it. */
function showDisplaySet(uid: string) {
  setMockViewportGrid({
    activeViewportId: 'v1',
    viewports: new Map([['v1', { displaySetInstanceUIDs: [uid] }]]),
  });
}
afterEach(() => {
  delete (window as any).config;
});

function makeDisplaySetService(displaySets: any[]) {
  const handlers: Record<string, Array<() => void>> = {};
  return {
    EVENTS: { DISPLAY_SETS_ADDED: 'added', DISPLAY_SETS_CHANGED: 'changed' },
    getActiveDisplaySets: jest.fn(() => displaySets),
    subscribe: jest.fn((evt: string, cb: () => void) => {
      (handlers[evt] ||= []).push(cb);
      return { unsubscribe: jest.fn() };
    }),
    emit: (evt: string) => (handlers[evt] || []).forEach(cb => cb()),
  };
}

/** Two studies for the same patient — the case the pinning rules exist for. */
const TWO_STUDIES = [
  {
    displaySetInstanceUID: 'ds-1',
    StudyInstanceUID: 'study-1',
    StudyDate: '20260812',
    StudyDescription: 'Breast MRI',
    SeriesInstanceUID: 'se-1',
    SeriesDescription: 'Ax T1 post',
    SeriesNumber: 1,
    Modality: 'MR',
    numImageFrames: 103,
  },
  {
    displaySetInstanceUID: 'ds-2',
    StudyInstanceUID: 'study-2',
    StudyDate: '20250101',
    StudyDescription: 'Follow-up MRI',
    SeriesInstanceUID: 'se-2',
    SeriesDescription: 'Ax T2',
    SeriesNumber: 1,
    Modality: 'MR',
    numImageFrames: 88,
  },
];

async function renderPanel(displaySets: any[] = TWO_STUDIES) {
  const dss = makeDisplaySetService(displaySets);
  withSystem(makeServicesManager({ services: { displaySetService: dss } }));
  let utils: any;
  await act(async () => {
    utils = render(<ChatPanel />);
  });
  return { dss, ...utils };
}

/** Move the viewer to another study and let the panel observe it. */
async function moveViewerTo(studyUID: string, rerender: any) {
  mockActiveStudy = studyUID;
  await act(async () => {
    rerender(<ChatPanel />);
  });
}

const COMPOSER = 'Ask about these images...';

describe('ChatPanel — display-set context refresh', () => {
  it('subscribes to display-set add/change and reloads series for the active study', async () => {
    const dss = makeDisplaySetService([]);
    withSystem(makeServicesManager({ services: { displaySetService: dss } }));
    await act(async () => {
      render(<ChatPanel />);
    });

    // The panel watches display-set lifecycle events (not just study-UID changes).
    const events = dss.subscribe.mock.calls.map((c: any[]) => c[0]);
    expect(events).toEqual(expect.arrayContaining(['added', 'changed']));

    // A series hydrating after the initial study load appears without any study change.
    dss.getActiveDisplaySets.mockReturnValue([
      {
        displaySetInstanceUID: 'ds-late',
        StudyInstanceUID: 'study-1',
        SeriesInstanceUID: 'se-9',
        SeriesDescription: 'Late T2',
        SeriesNumber: 9,
        Modality: 'MR',
        numImageFrames: 30,
      },
    ]);
    showDisplaySet('ds-late');
    await act(async () => {
      dss.emit('added');
    });

    // The series hydrated after the study loaded, and the panel attached it
    // because the viewport is showing it.
    expect(screen.getByLabelText('Remove Late T2')).toBeTruthy();
  });
});

describe('ChatPanel — study label on anonymised data', () => {
  it('labels a study with no date or description by its accession', async () => {
    // Shaped like the real UKA study as Orthanc holds it: one MR series, no
    // (0008,0020), no (0008,1030), and the cohort identifier in (0008,0050).
    // Before the accession fallback this rendered "Study …5106477", which tells
    // a reader nothing about which study the panel is answering from.
    mockActiveStudy = 'study-uka';
    await renderPanel([
      {
        StudyInstanceUID: 'study-uka',
        AccessionNumber: 'UKA_1',
        SeriesInstanceUID: 'se-uka',
        SeriesDescription: 'NCI-dyn DEV',
        SeriesNumber: 401,
        Modality: 'MR',
        numImageFrames: 155,
      },
    ]);
    expect(screen.getByText('UKA_1')).toBeTruthy();
    expect(screen.queryByText(/Study …/)).toBeNull();
  });
});

describe('ChatPanel — folding the prompt context', () => {
  const heading = () => screen.getByRole('button', { name: /Prompt context/ });

  it('starts open', async () => {
    showDisplaySet('ds-1');
    await renderPanel();
    expect(heading().getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByLabelText('Remove Ax T1 post')).toBeTruthy();
  });

  it('folds the controls away when the heading is clicked', async () => {
    showDisplaySet('ds-1');
    await renderPanel();
    fireEvent.click(heading());
    expect(heading().getAttribute('aria-expanded')).toBe('false');
    // The per-series chips and range controls are what folding is for.
    expect(screen.queryByLabelText('Remove Ax T1 post')).toBeNull();
  });

  it('still says what the next message will send', async () => {
    // The point of the summary: folding hides controls, never the claim. A
    // composer that looks empty while images are attached is exactly the silent
    // disagreement the panel exists to prevent.
    showDisplaySet('ds-1');
    await renderPanel();
    fireEvent.click(heading());
    expect(screen.getByText(/Ax T1 post · 5 images/)).toBeTruthy();
  });

  it('says so when nothing is attached', async () => {
    await renderPanel();
    fireEvent.click(heading());
    expect(screen.getByText(/no series/)).toBeTruthy();
  });

  it('unfolds again from the summary line', async () => {
    showDisplaySet('ds-1');
    await renderPanel();
    fireEvent.click(heading());
    fireEvent.click(screen.getByText(/Ax T1 post/));
    expect(screen.getByLabelText('Remove Ax T1 post')).toBeTruthy();
  });

  it('keeps the study-divergence warning visible while folded', async () => {
    // A correctness warning about the message about to be sent is not part of
    // what folding is allowed to hide.
    const { rerender } = await renderPanel();
    fireEvent.change(screen.getByPlaceholderText(COMPOSER), { target: { value: 'x' } });
    await moveViewerTo('study-2', rerender);
    fireEvent.click(heading());
    expect(screen.getByText(/Viewer moved to/)).toBeTruthy();
  });

  it('remembers the choice for the session', async () => {
    const { unmount } = await renderPanel();
    fireEvent.click(heading());
    unmount();
    await renderPanel();
    expect(heading().getAttribute('aria-expanded')).toBe('false');
  });
});

describe('ChatPanel — following vs pinned', () => {
  it('follows the viewer while the prompt is untouched', async () => {
    const { rerender } = await renderPanel();
    expect(screen.getByText('Follows viewer')).toBeTruthy();
    expect(screen.getByText('2026-08-12 · Breast MRI')).toBeTruthy();

    await moveViewerTo('study-2', rerender);

    // Nothing was invested in the prompt, so adopting the new study is safe and
    // needs no warning.
    expect(screen.getByText('2025-01-01 · Follow-up MRI')).toBeTruthy();
    expect(screen.queryByText(/Viewer moved to/)).toBeNull();
  });

  it('pins the context as soon as the user types', async () => {
    showDisplaySet('ds-1');
    const { rerender } = await renderPanel();
    fireEvent.change(screen.getByPlaceholderText(COMPOSER), {
      target: { value: 'Is this suspicious?' },
    });
    expect(screen.getByText('Pinned')).toBeTruthy();

    await moveViewerTo('study-2', rerender);

    // The half-written question was about study-1; the context must not move.
    expect(screen.getByText(/Viewer moved to/)).toBeTruthy();
    // Still bound to study-1, and study-2's series was not attached under it.
    // Twice: the context line, and the divergence banner naming what will be sent.
    expect(screen.getAllByText('2026-08-12 · Breast MRI').length).toBeGreaterThan(0);
    expect(screen.queryByLabelText('Remove Ax T2')).toBeNull();
  });

  it('pins the context when a series is detached', async () => {
    // Attaching is automatic now, so it is not an investment in the prompt.
    // Removing one is: it says "not this", and the viewer must not put it back.
    showDisplaySet('ds-1');
    const { rerender } = await renderPanel();
    expect(screen.getByText('Follows viewer')).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Remove Ax T1 post'));
    expect(screen.getByText('Pinned')).toBeTruthy();
    expect(screen.queryByLabelText('Remove Ax T1 post')).toBeNull();

    await moveViewerTo('study-2', rerender);
    expect(screen.getByText(/Viewer moved to/)).toBeTruthy();
  });

  it('names both studies in the divergence warning', async () => {
    // "Something changed" is not actionable; the user needs to know which study
    // the prompt will actually use.
    const { rerender } = await renderPanel();
    fireEvent.change(screen.getByPlaceholderText(COMPOSER), { target: { value: 'x' } });
    await moveViewerTo('study-2', rerender);

    const banner = screen.getByText(/Viewer moved to/).closest('div')!;
    expect(banner.textContent).toContain('2025-01-01 · Follow-up MRI');
    expect(banner.textContent).toContain('2026-08-12 · Breast MRI');
  });

  it('re-targets the prompt on "Use current viewer"', async () => {
    const { rerender } = await renderPanel();
    fireEvent.change(screen.getByPlaceholderText(COMPOSER), { target: { value: 'x' } });
    await moveViewerTo('study-2', rerender);

    await act(async () => {
      fireEvent.click(screen.getByText('Use current viewer'));
    });

    expect(screen.queryByText(/Viewer moved to/)).toBeNull();
    expect(screen.getByText('2025-01-01 · Follow-up MRI')).toBeTruthy();
  });

  it('stays pinned after re-targeting while a question is half-written', async () => {
    // Resuming follow-mode here would let the *next* viewport change move the
    // context out from under the text still sitting in the composer.
    const { rerender } = await renderPanel();
    fireEvent.change(screen.getByPlaceholderText(COMPOSER), { target: { value: 'x' } });
    await moveViewerTo('study-2', rerender);
    await act(async () => {
      fireEvent.click(screen.getByText('Use current viewer'));
    });

    expect(screen.getByText('Pinned')).toBeTruthy();
  });

  it('can be pinned and unpinned manually', async () => {
    await renderPanel();
    fireEvent.click(screen.getByText('Follows viewer'));
    expect(screen.getByText('Pinned')).toBeTruthy();
    fireEvent.click(screen.getByText('Pinned'));
    expect(screen.getByText('Follows viewer')).toBeTruthy();
  });

  it('sends the pinned study, not whatever the viewer drifted to', async () => {
    // The headline safety property: what a message is sent with is decided by the
    // prompt context, never by the viewport at the moment Send is pressed.
    showDisplaySet('ds-1');
    const { rerender } = await renderPanel();
    fireEvent.change(screen.getByPlaceholderText(COMPOSER), { target: { value: 'suspicious?' } });

    await moveViewerTo('study-2', rerender);
    fireEvent.click(screen.getByTitle('Send'));

    expect(sendMessage).toHaveBeenCalledWith(
      'suspicious?',
      'study-1',
      ['se-1'],
      expect.objectContaining({
        studyInstanceUID: 'study-1',
        studyLabel: '2026-08-12 · Breast MRI',
      }),
      // These display sets carry no instance list, so no slice range can be
      // expressed for them. A selection still travels, carrying the recipe the
      // panel is showing so the middleware cannot apply a different one.
      [
        expect.objectContaining({
          series_uid: 'se-1',
          sop_instance_uids: [],
          num_slices: 5,
          slice_strategy: 'central',
        }),
      ]
    );
  });

  it('stamps the message with the series and image bound in force at send time', async () => {
    showDisplaySet('ds-1');
    await renderPanel();
    fireEvent.change(screen.getByPlaceholderText(COMPOSER), { target: { value: 'q' } });
    fireEvent.click(screen.getByTitle('Send'));

    const snapshot = sendMessage.mock.calls[0][3];
    expect(snapshot.series).toEqual([
      expect.objectContaining({ seriesInstanceUID: 'se-1', description: 'Ax T1 post' }),
    ]);
    // Default recipe is 5 central slices; the series has 103 frames, so 5.
    expect(snapshot.requestedImageCount).toBe(5);
  });

  it('detaches a series from its chip, and offers the way back', async () => {
    // With the series picker gone, the follow toggle is the only route back —
    // so the empty state has to name it rather than leave a dead end.
    showDisplaySet('ds-1');
    await renderPanel();
    expect(screen.getByText(/Sends 5 images in total/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Remove Ax T1 post'));
    expect(screen.getByText(/No series attached/)).toBeTruthy();
    const back = screen.getByRole('button', { name: 'Follows viewer' });
    expect(back).toBeTruthy();

    fireEvent.click(back);
    expect(screen.getByLabelText('Remove Ax T1 post')).toBeTruthy();
  });
});

describe('ChatPanel — debug API base', () => {
  it('defaults to the same-origin /chat-api route', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    (global as any).fetch = fetchMock;
    await renderPanel();
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/chat-api/debug/config'));
  });

  it('honors window.config.chatApiBase for the debug endpoints', async () => {
    // Read lazily at call time, so setting the override before mount is enough —
    // no module reload (which would give React a second dispatcher).
    (window as any).config = { chatApiBase: 'http://localhost:5560' };
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    (global as any).fetch = fetchMock;
    await renderPanel();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('http://localhost:5560/debug/config')
    );
  });
});
