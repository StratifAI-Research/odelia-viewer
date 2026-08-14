import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
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
  mockActiveStudy = 'study-1';
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
});
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
        StudyInstanceUID: 'study-1',
        SeriesInstanceUID: 'se-9',
        SeriesDescription: 'Late T2',
        SeriesNumber: 9,
        Modality: 'MR',
        numImageFrames: 30,
      },
    ]);
    act(() => dss.emit('added'));

    fireEvent.click(screen.getByText('+ Add series'));
    expect(screen.getByText('Late T2')).toBeTruthy();
  });
});

describe('ChatPanel — following vs pinned', () => {
  it('follows the viewer while the prompt is untouched', async () => {
    const { rerender } = await renderPanel();
    expect(screen.getByText('Following viewer')).toBeTruthy();
    expect(screen.getByText('2026-08-12 · Breast MRI')).toBeTruthy();

    await moveViewerTo('study-2', rerender);

    // Nothing was invested in the prompt, so adopting the new study is safe and
    // needs no warning.
    expect(screen.getByText('2025-01-01 · Follow-up MRI')).toBeTruthy();
    expect(screen.queryByText(/Viewer moved to/)).toBeNull();
  });

  it('pins the context as soon as the user types', async () => {
    const { rerender } = await renderPanel();
    fireEvent.change(screen.getByPlaceholderText(COMPOSER), {
      target: { value: 'Is this suspicious?' },
    });
    expect(screen.getByText('Pinned')).toBeTruthy();

    await moveViewerTo('study-2', rerender);

    // The half-written question was about study-1; the context must not move.
    expect(screen.getByText(/Viewer moved to/)).toBeTruthy();
    // Still bound to study-1: its series are offered, not study-2's.
    fireEvent.click(screen.getByText('+ Add series'));
    expect(screen.getByText('Ax T1 post')).toBeTruthy();
    expect(screen.queryByText('Ax T2')).toBeNull();
  });

  it('pins the context when a series is attached', async () => {
    const { rerender } = await renderPanel();
    fireEvent.click(screen.getByText('+ Add series'));
    fireEvent.click(screen.getByText('Ax T1 post'));
    expect(screen.getByText('Pinned')).toBeTruthy();

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
    fireEvent.click(screen.getByText('Following viewer'));
    expect(screen.getByText('Pinned')).toBeTruthy();
    fireEvent.click(screen.getByText('Pinned'));
    expect(screen.getByText('Following viewer')).toBeTruthy();
  });

  it('sends the pinned study, not whatever the viewer drifted to', async () => {
    // The headline safety property: what a message is sent with is decided by the
    // prompt context, never by the viewport at the moment Send is pressed.
    const { rerender } = await renderPanel();
    fireEvent.click(screen.getByText('+ Add series'));
    fireEvent.click(screen.getByText('Ax T1 post'));
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
      })
    );
  });

  it('stamps the message with the series and image bound in force at send time', async () => {
    await renderPanel();
    fireEvent.click(screen.getByText('+ Add series'));
    fireEvent.click(screen.getByText('Ax T1 post'));
    fireEvent.change(screen.getByPlaceholderText(COMPOSER), { target: { value: 'q' } });
    fireEvent.click(screen.getByTitle('Send'));

    const snapshot = sendMessage.mock.calls[0][3];
    expect(snapshot.series).toEqual([
      expect.objectContaining({ seriesInstanceUID: 'se-1', description: 'Ax T1 post' }),
    ]);
    // Default recipe is 5 central slices; the series has 103 frames, so 5.
    expect(snapshot.requestedImageCount).toBe(5);
  });

  it('detaches a series from its chip', async () => {
    await renderPanel();
    fireEvent.click(screen.getByText('+ Add series'));
    fireEvent.click(screen.getByText('Ax T1 post'));
    expect(screen.getByText(/Sends 5 slices\/series/)).toBeTruthy();

    fireEvent.click(screen.getByLabelText('Remove Ax T1 post'));
    expect(screen.getByText(/No series attached/)).toBeTruthy();
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
