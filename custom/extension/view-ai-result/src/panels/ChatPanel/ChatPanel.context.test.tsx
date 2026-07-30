import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  installConsoleErrorFilter,
  makeServicesManager,
  withSystem,
} from '../../test-utils/harness';

import ChatPanel from './ChatPanel';

// Isolated ChatPanel harness for the display-set-context refresh and the
// debug-API-base override. useChatService is stubbed; useActiveStudyUID is
// forced to resolve a study so the display-set subscription installs.
const mockHookState: any = {
  messages: [],
  isConnected: true,
  isStreaming: false,
  error: null,
  sessionId: 'session-abcdef01',
  preprocessingStatus: null,
  preprocessingProgress: null,
  connect: jest.fn(),
  sendMessage: jest.fn(),
  cancelGeneration: jest.fn(),
  clearHistory: jest.fn(),
  disconnect: jest.fn(),
};
jest.mock('../../hooks/useChatService', () => ({ useChatService: () => mockHookState }));
jest.mock('../../hooks/useActiveStudyUID', () => ({ useActiveStudyUID: () => () => 'study-1' }));

installConsoleErrorFilter();
beforeAll(() => {
  (Element.prototype as any).scrollIntoView = jest.fn();
  (HTMLElement.prototype as any).focus = jest.fn();
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

describe('ChatPanel — display-set context refresh', () => {
  it('subscribes to display-set add/change and reloads series for the active study', () => {
    const dss = makeDisplaySetService([]);
    withSystem(makeServicesManager({ services: { displaySetService: dss } }));
    render(<ChatPanel />);

    // The panel now watches display-set lifecycle events (not just study-UID changes).
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

    fireEvent.click(screen.getByText('No series selected'));
    expect(screen.getByText('Late T2')).toBeTruthy();
  });
});

describe('ChatPanel — debug API base', () => {
  it('defaults to the same-origin /chat-api route', async () => {
    withSystem(makeServicesManager());
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    (global as any).fetch = fetchMock;

    render(<ChatPanel />);
    await act(async () => {
      fireEvent.click(screen.getByTitle('Settings'));
    });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/chat-api/debug/config'));
  });

  it('honors window.config.chatApiBase for the debug endpoints', async () => {
    // Read lazily at call time, so setting the override before opening settings
    // is enough — no module reload (which would give React a second dispatcher).
    (window as any).config = { chatApiBase: 'http://localhost:5560' };
    withSystem(makeServicesManager());
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    (global as any).fetch = fetchMock;

    render(<ChatPanel />);
    await act(async () => {
      fireEvent.click(screen.getByTitle('Settings'));
    });
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('http://localhost:5560/debug/config')
    );
  });
});
