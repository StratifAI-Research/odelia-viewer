import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  installConsoleErrorFilter,
  makeServicesManager,
  withSystem,
} from '../../test-utils/harness';

import ChatPanel from './ChatPanel';

// Harness for the chat-thread switcher. useChatService is stubbed so the test
// controls the displayed transcript and can assert what the panel asks the
// service to do when a thread is opened.
const hookState: any = {};
const switchSession = jest.fn();
const hydrateMessages = jest.fn();
// Faithful to the real hook, which empties the transcript. Without that the
// panel's persist effect would immediately write the cleared thread back.
const clearHistory = jest.fn(() => {
  hookState.messages = [];
});

function setHook(over: Partial<typeof hookState> = {}) {
  Object.assign(hookState, {
    messages: [],
    isConnected: true,
    isStreaming: false,
    error: null,
    sessionId: 'sess-current',
    preprocessingStatus: null,
    preprocessingProgress: null,
    connect: jest.fn(),
    sendMessage: jest.fn(),
    cancelGeneration: jest.fn(),
    clearHistory,
    appendEvent: jest.fn(),
    switchSession,
    hydrateMessages,
    disconnect: jest.fn(),
    ...over,
  });
}

jest.mock('../../hooks/useChatService', () => ({ useChatService: () => hookState }));

const STORAGE_KEY = 'odelia.chat.threads.v1';

const msg = (over: any = {}) => ({
  id: `m-${Math.random()}`,
  role: 'user',
  content: 'hello',
  timestamp: new Date('2026-08-14T10:00:00Z').toISOString(),
  ...over,
});

/** Seed sessionStorage with stored threads, as an earlier visit would have. */
function seedThreads(threads: any[]) {
  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(threads));
}

const storedThread = (over: any = {}) => ({
  id: 't1',
  title: 'Is this lesion suspicious?',
  createdAt: Date.now() - 3600_000,
  updatedAt: Date.now() - 3600_000,
  serverSessionId: 'sess-1',
  messages: [msg({ id: 'u1', role: 'user', content: 'Is this lesion suspicious?' })],
  ...over,
});

/**
 * Route fetch for /debug/config and /debug/sessions independently.
 *
 * The method matters as well as the URL: the session list and the session
 * delete share a path prefix, and a router that ignored the verb would answer
 * a DELETE with a session list and hide whether it was sent at all.
 *
 * `deleteResponse` overrides what the DELETE answers, so the failure paths can
 * be driven without disturbing the listing.
 */
function routeFetch(
  sessions?: Array<{ session_id: string; message_count: number }> | 'fail',
  deleteResponse?: { ok: boolean; status: number } | 'reject'
) {
  const fetchMock = jest.fn((url: string, init?: any) => {
    if (init?.method === 'DELETE') {
      if (deleteResponse === 'reject') {
        return Promise.reject(new Error('network down'));
      }
      const { ok, status } = deleteResponse ?? { ok: true, status: 200 };
      return Promise.resolve({ ok, status, json: async () => ({}) });
    }
    if (String(url).includes('/debug/sessions')) {
      if (sessions === 'fail') {
        return Promise.resolve({ ok: false, status: 500, json: async () => ({}) });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ sessions: sessions ?? [] }),
      });
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
  (global as any).fetch = fetchMock;
  return fetchMock;
}

/** The session ids a run asked the middleware to delete, in order. */
const deletedSessionIds = (fetchMock: jest.Mock): string[] =>
  fetchMock.mock.calls
    .filter(([, init]: any[]) => init?.method === 'DELETE')
    .map(([url]: any[]) => String(url).replace(/^.*\/debug\/sessions\//, ''));

installConsoleErrorFilter();
beforeAll(() => {
  (Element.prototype as any).scrollIntoView = jest.fn();
  (HTMLElement.prototype as any).focus = jest.fn();
});

beforeEach(() => {
  jest.clearAllMocks();
  window.sessionStorage.clear();
  switchSession.mockResolvedValue('sess-new');
  setHook();
  withSystem(makeServicesManager());
  routeFetch();
});

async function renderPanel() {
  await act(async () => {
    render(<ChatPanel />);
  });
}

async function openHistory() {
  await act(async () => {
    fireEvent.click(screen.getByTitle('Chat history'));
  });
}

describe('ChatPanel — chat history switcher', () => {
  it('offers a history control in the header', async () => {
    await renderPanel();
    expect(screen.getByTitle('Chat history')).toBeTruthy();
  });

  it('explains that history is scoped to this browser tab when empty', async () => {
    // Transcripts are deliberately not persisted beyond the tab; saying so beats
    // an empty list the user cannot interpret.
    await renderPanel();
    await openHistory();
    expect(screen.getByText(/No earlier chats/)).toBeTruthy();
    expect(screen.getByText(/this browser tab only/)).toBeTruthy();
  });

  it('lists stored chats with their title and recency', async () => {
    seedThreads([storedThread()]);
    await renderPanel();
    await openHistory();

    expect(screen.getByText('Is this lesion suspicious?')).toBeTruthy();
    expect(screen.getByText(/1h ago · 1 message/)).toBeTruthy();
  });

  it('opens a stored chat: restores its transcript and rejoins its session', async () => {
    // The two halves are separate on purpose — the browser owns the transcript,
    // the middleware owns what the model remembers.
    seedThreads([storedThread()]);
    await renderPanel();
    await openHistory();

    await act(async () => {
      fireEvent.click(screen.getByText('Is this lesion suspicious?'));
    });

    expect(hydrateMessages).toHaveBeenCalledTimes(1);
    expect(hydrateMessages.mock.calls[0][0]).toHaveLength(1);
    expect(hydrateMessages.mock.calls[0][0][0].content).toBe('Is this lesion suspicious?');
    expect(switchSession).toHaveBeenCalledWith('sess-1');
  });

  it('opens a chat with no recorded session against a fresh one', async () => {
    // The transcript is still worth reading; the model simply starts from nothing.
    seedThreads([storedThread({ serverSessionId: null })]);
    await renderPanel();
    await openHistory();
    await act(async () => {
      fireEvent.click(screen.getByText('Is this lesion suspicious?'));
    });
    expect(switchSession).toHaveBeenCalledWith('new');
  });

  it('starts a new chat on both sides', async () => {
    await renderPanel();
    await openHistory();
    await act(async () => {
      fireEvent.click(screen.getByText('+ New chat'));
    });
    expect(hydrateMessages).toHaveBeenCalledWith([]);
    expect(switchSession).toHaveBeenCalledWith('new');
  });

  it('persists the active conversation once it has messages', async () => {
    setHook({
      messages: [{ id: 'u1', role: 'user', content: 'What is this?', timestamp: new Date() }],
    });
    await renderPanel();

    const stored = JSON.parse(window.sessionStorage.getItem(STORAGE_KEY)!);
    expect(stored).toHaveLength(1);
    expect(stored[0].title).toBe('What is this?');
    // The thread is joined to the live middleware session.
    expect(stored[0].serverSessionId).toBe('sess-current');
  });

  it('does not litter history with empty conversations', async () => {
    // A panel that merely mounted must not create a "New chat" entry.
    await renderPanel();
    expect(window.sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it('deletes a chat from the list', async () => {
    seedThreads([storedThread(), storedThread({ id: 't2', title: 'Second chat' })]);
    await renderPanel();
    await openHistory();

    await act(async () => {
      fireEvent.click(screen.getByLabelText('Delete Second chat'));
    });
    expect(screen.queryByText('Second chat')).toBeNull();
    expect(screen.getByText('Is this lesion suspicious?')).toBeTruthy();
  });

  describe('closing the session on the other side', () => {
    // A middleware session holds the conversation, and its history holds the
    // base64 slices of every turn -- the same strings the image cache holds, so
    // an abandoned session pins them past the cache's own eviction bound. The
    // cache is bounded; sessions are not, and nothing sweeps them.

    it('deletes the middleware session behind a chat that is not open', async () => {
      const fetchMock = routeFetch();
      seedThreads([
        storedThread(),
        storedThread({ id: 't2', title: 'Second chat', serverSessionId: 'sess-2' }),
      ]);
      await renderPanel();
      await openHistory();

      await act(async () => {
        fireEvent.click(screen.getByLabelText('Delete Second chat'));
      });

      expect(deletedSessionIds(fetchMock)).toEqual(['sess-2']);
      // No socket is attached to a thread that is not open, so nothing has to
      // be detached first.
      expect(switchSession).not.toHaveBeenCalled();
    });

    it("uses the live socket's session for the chat that is open", async () => {
      // The persisted id trails the live one by a render while a session is
      // being established. Deleting the stale id would report success and leave
      // the real session behind.
      const fetchMock = routeFetch();
      setHook({ sessionId: 'sess-live' });
      seedThreads([storedThread({ serverSessionId: 'sess-stale' })]);
      await renderPanel();
      await openHistory();

      // Open it, so it is the thread the socket is attached to.
      await act(async () => {
        fireEvent.click(screen.getByText('Is this lesion suspicious?'));
      });
      await openHistory();
      await act(async () => {
        fireEvent.click(screen.getByLabelText(/^Delete /));
      });

      expect(deletedSessionIds(fetchMock)).toEqual(['sess-live']);
    });

    it('detaches from the open chat before asking the server to drop it', async () => {
      // Deleting a session out from under a live connection is the one case the
      // middleware cannot make tidy, so the socket moves off it first.
      const order: string[] = [];
      const fetchMock = jest.fn((url: string, init?: any) => {
        if (init?.method === 'DELETE') {
          order.push('delete');
          return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
        }
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ sessions: [] }) });
      });
      (global as any).fetch = fetchMock;

      seedThreads([storedThread()]);
      await renderPanel();
      await openHistory();
      await act(async () => {
        fireEvent.click(screen.getByText('Is this lesion suspicious?'));
      });

      // Only the detach that the deletion itself performs is of interest; the
      // one that opened the thread has already happened.
      switchSession.mockImplementation(async () => {
        order.push('switchSession');
        return 'sess-new';
      });

      await openHistory();
      await act(async () => {
        fireEvent.click(screen.getByLabelText(/^Delete /));
      });

      expect(order).toEqual(['switchSession', 'delete']);
    });

    it('still closes the old session when reconnecting fails', async () => {
      // A failed reconnect is the panel's problem to report elsewhere. Letting
      // it skip the DELETE would abandon exactly the session this path exists
      // to close.
      const fetchMock = routeFetch();
      setHook({ sessionId: 'sess-live' });
      seedThreads([storedThread()]);
      await renderPanel();
      await openHistory();
      await act(async () => {
        fireEvent.click(screen.getByText('Is this lesion suspicious?'));
      });
      await openHistory();

      // Only the reconnect that the deletion itself performs fails.
      switchSession.mockRejectedValueOnce(new Error('socket down'));
      await act(async () => {
        fireEvent.click(screen.getByLabelText(/^Delete /));
      });

      expect(deletedSessionIds(fetchMock)).toEqual(['sess-live']);
      expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY)!)).toHaveLength(0);
    });

    it('sends nothing for a chat that never reached the middleware', async () => {
      const fetchMock = routeFetch();
      seedThreads([
        storedThread(),
        storedThread({ id: 't2', title: 'Second chat', serverSessionId: null }),
      ]);
      await renderPanel();
      await openHistory();

      await act(async () => {
        fireEvent.click(screen.getByLabelText('Delete Second chat'));
      });

      expect(deletedSessionIds(fetchMock)).toEqual([]);
    });

    it.each([
      ['a 404, which is the outcome asked for', { ok: false, status: 404 } as const],
      ['a server error', { ok: false, status: 500 } as const],
      ['an unreachable middleware', 'reject' as const],
    ])('still deletes the chat locally on %s', async (_label, deleteResponse) => {
      // The user asked to delete a conversation. A middleware they cannot reach
      // is not something they can act on, and leaving the chat in the list
      // would answer their request with someone else's problem.
      routeFetch(undefined, deleteResponse);
      seedThreads([
        storedThread(),
        storedThread({ id: 't2', title: 'Second chat', serverSessionId: 'sess-2' }),
      ]);
      await renderPanel();
      await openHistory();

      await act(async () => {
        fireEvent.click(screen.getByLabelText('Delete Second chat'));
      });

      expect(screen.queryByText('Second chat')).toBeNull();
      expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY)!)).toHaveLength(1);
      // Nothing is said about it: the notification would be about infrastructure
      // the reader cannot do anything with.
      expect(screen.queryByText(/could not close/i)).toBeNull();
    });
  });

  describe('server-side memory', () => {
    it('flags a chat the middleware no longer holds', async () => {
      // Sessions live in RAM on the middleware, so a restart drops them all.
      routeFetch([{ session_id: 'someone-else', message_count: 4 }]);
      seedThreads([storedThread()]);
      await renderPanel();
      await openHistory();

      expect(screen.getByText('Assistant no longer remembers this')).toBeTruthy();
    });

    it('treats an empty server session as forgotten', async () => {
      // Reconnecting to a dropped id does not fail — the middleware just makes a
      // fresh empty session — so "present but empty" is the real signal.
      routeFetch([{ session_id: 'sess-1', message_count: 0 }]);
      seedThreads([storedThread()]);
      await renderPanel();
      await openHistory();

      expect(screen.getByText('Assistant no longer remembers this')).toBeTruthy();
    });

    it('does not flag a chat the middleware still holds', async () => {
      routeFetch([{ session_id: 'sess-1', message_count: 2 }]);
      seedThreads([storedThread()]);
      await renderPanel();
      await openHistory();

      expect(screen.queryByText('Assistant no longer remembers this')).toBeNull();
    });

    it('does not raise a false alarm on the conversation just answered', async () => {
      // Regression: the persisted serverSessionId trails the live socket by a
      // render, so reading the stale value flagged a chat that had just been
      // answered. For the open thread the live session is authoritative.
      routeFetch([{ session_id: 'sess-current', message_count: 2 }]);
      setHook({
        messages: [{ id: 'u1', role: 'user', content: 'Just asked this', timestamp: new Date() }],
      });
      await renderPanel();
      await openHistory();

      // Appears twice: as the history entry's title and as the message itself.
      expect(screen.getAllByText('Just asked this').length).toBeGreaterThanOrEqual(2);
      expect(screen.queryByText('Assistant no longer remembers this')).toBeNull();
      expect(screen.queryByText(/no longer has this conversation in memory/)).toBeNull();
    });

    it('stays quiet while the answer is still streaming', async () => {
      // The middleware commits a turn only after generation ends, so mid-stream
      // its session is legitimately empty. Warning then would flash "forgotten"
      // over an answer being written.
      routeFetch([]);
      setHook({
        isStreaming: true,
        messages: [
          { id: 'u1', role: 'user', content: 'Mid-flight', timestamp: new Date() },
          { id: 'a1', role: 'assistant', content: '', timestamp: new Date(), isStreaming: true },
        ],
      });
      await renderPanel();
      await openHistory();

      expect(screen.queryByText('Assistant no longer remembers this')).toBeNull();
      expect(screen.queryByText(/no longer has this conversation in memory/)).toBeNull();
    });

    it('says nothing when the lookup itself failed', async () => {
      // Unknown is not the same as forgotten; claiming memory loss on a failed
      // request would be a false alarm.
      routeFetch('fail');
      seedThreads([storedThread()]);
      await renderPanel();
      await openHistory();

      expect(screen.queryByText('Assistant no longer remembers this')).toBeNull();
    });

    it('warns above the composer once a forgotten chat is opened', async () => {
      // The banner has to sit where the next question is typed, not only in a
      // menu the user has already closed.
      routeFetch([{ session_id: 'other', message_count: 1 }]);
      seedThreads([storedThread()]);
      await renderPanel();
      await openHistory();
      await act(async () => {
        fireEvent.click(screen.getByText('Is this lesion suspicious?'));
      });

      expect(screen.getByText(/no longer has this conversation in memory/)).toBeTruthy();
      expect(screen.getByText(/answered without them/)).toBeTruthy();
    });
  });

  it('deleting the open conversation discards its session too', async () => {
    // Deleting from the history list is now the only way to throw a conversation
    // away — the separate "Clear conversation" menu item is gone — so it has to
    // do the whole job: the stored thread, the displayed transcript, and the
    // middleware session behind it. Leaving any one would resurrect the
    // conversation on the next switch.
    setHook({
      messages: [{ id: 'u1', role: 'user', content: 'Throwaway', timestamp: new Date() }],
    });
    await renderPanel();
    expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY)!)).toHaveLength(1);

    await act(async () => {
      fireEvent.click(screen.getByTitle('Chat history'));
    });
    await act(async () => {
      fireEvent.click(screen.getByLabelText(/^Delete /));
    });

    expect(clearHistory).toHaveBeenCalled();
    expect(JSON.parse(window.sessionStorage.getItem(STORAGE_KEY)!)).toHaveLength(0);
    expect(switchSession).toHaveBeenCalledWith('new');
  });
});
