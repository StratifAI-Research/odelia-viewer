import { ChatService, ChatConnectionState, stripSessionSegment } from './ChatService';
import { CHAT_EVENTS, ClientMessageType, ServerMessageType } from '../types/chatTypes';

// Minimal fake WebSocket: records sends, exposes handlers, lets tests drive
// open/message/close/error synchronously. No real network.
class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances: FakeWebSocket[] = [];

  url: string;
  readyState = FakeWebSocket.CONNECTING;
  sent: string[] = [];
  closed: { code?: number; reason?: string } | null = null;

  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onerror: ((e: any) => void) | null = null;
  onclose: ((e: { code: number; reason: string; wasClean: boolean }) => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string) {
    this.sent.push(data);
  }

  close(code = 1000, reason = '') {
    if (this.readyState === FakeWebSocket.CLOSED) {
      return;
    }
    this.readyState = FakeWebSocket.CLOSED;
    this.closed = { code, reason };
    // Mirror a real socket: closing fires onclose, which clears the connect
    // timeout and publishes DISCONNECTED.
    this.onclose?.({ code, reason, wasClean: code === 1000 });
  }

  // test helpers
  emitOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }
  emitMessage(obj: any) {
    this.onmessage?.({ data: JSON.stringify(obj) });
  }
  emitRaw(data: string) {
    this.onmessage?.({ data });
  }
  emitError() {
    this.onerror?.(new Error('ws error'));
  }
  emitClose(code = 1006, reason = '', wasClean = false) {
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.({ code, reason, wasClean });
  }
}

const lastWs = () => FakeWebSocket.instances[FakeWebSocket.instances.length - 1];

let logSpy: jest.SpyInstance, warnSpy: jest.SpyInstance, errSpy: jest.SpyInstance;

beforeEach(() => {
  FakeWebSocket.instances = [];
  (global as any).WebSocket = FakeWebSocket;
  delete (window as any).config;
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  logSpy.mockRestore();
  warnSpy.mockRestore();
  errSpy.mockRestore();
  jest.clearAllMocks();
  jest.useRealTimers();
});

// Connect helper: kick off connect(), open the socket, deliver CONNECTED.
const connect = async (svc: ChatService, sessionId = 'sess-1') => {
  const promise = svc.connect();
  const ws = lastWs();
  ws.emitOpen();
  ws.emitMessage({ type: ServerMessageType.CONNECTED, session_id: sessionId });
  await promise;
  return ws;
};

describe('ChatService', () => {
  it('constructs and derives a wsUrl', () => {
    const svc = new ChatService();
    expect(svc).toBeInstanceOf(ChatService);
    expect(svc.EVENTS).toBe(CHAT_EVENTS);
    expect(svc.isConnected()).toBe(false);
    expect(svc.getSessionId()).toBeNull();
  });

  // The published image is commonly run as `docker run -p 3000:80`, which puts
  // it on localhost:3000 — the same host/port the dev-server fallback matches.
  // Only the NODE_ENV guard keeps the two apart, and webpack strips the branch
  // from a production bundle, so assert the guard rather than the host check.
  describe('dev-server fallback', () => {
    const asLocalhost3000 = (run: () => void) => {
      const original = window.location;
      Object.defineProperty(window, 'location', {
        value: { protocol: 'http:', hostname: 'localhost', port: '3000', host: 'localhost:3000' },
        configurable: true,
      });
      try {
        run();
      } finally {
        Object.defineProperty(window, 'location', { value: original, configurable: true });
      }
    };

    const wsUrlFor = (nodeEnv: string) => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = nodeEnv;
      let url = '';
      try {
        asLocalhost3000(() => {
          const svc = new ChatService();
          svc.connect().catch(() => {});
          const ws = lastWs();
          url = ws.url;
          ws.close();
        });
      } finally {
        process.env.NODE_ENV = originalEnv;
      }
      return url;
    };

    it('points at the separate middleware port in development', () => {
      expect(wsUrlFor('development')).toBe('ws://localhost:5560/ws/chat/new');
    });

    it('stays on the viewer origin in a production build', () => {
      expect(wsUrlFor('production')).toBe('ws://localhost:3000/ws/chat/new');
    });
  });

  it('honors an explicit wsUrl from window.config, appending the session segment', () => {
    // The endpoint is /ws/chat/{session_id}, so the override is a BASE. Using it
    // verbatim could never have matched the route — it only appeared to work
    // because nothing asserted against a real middleware.
    (window as any).config = { chatMiddleware: { wsUrl: 'ws://custom/ws' } };
    const svc = new ChatService();
    // connect() rejects when the socket closes before the session handshake, and
    // this test tears the socket down deliberately, so swallow it.
    svc.connect().catch(() => {});
    const ws = lastWs();
    expect(ws.url).toBe('ws://custom/ws/new');
    // Tear the socket down so the 10s connection timeout armed by connect() is
    // cleared (via onclose) instead of leaking as an open handle.
    ws.close();
  });

  it('strips a trailing session segment from a legacy configured wsUrl', () => {
    // Deployments configured this back when it was the complete URL; a literal
    // `new` left in place would make resuming a conversation impossible.
    (window as any).config = { chatMiddleware: { wsUrl: 'ws://custom/ws/chat/new' } };
    const svc = new ChatService();
    svc.connect('sess-1').catch(() => {});
    const ws = lastWs();
    expect(ws.url).toBe('ws://custom/ws/chat/sess-1');
    ws.close();
  });

  describe('session targeting', () => {
    it('connects to an explicit session id', async () => {
      const svc = new ChatService();
      const p = svc.connect('sess-1');
      const ws = lastWs();
      expect(ws.url).toMatch(/\/ws\/chat\/sess-1$/);
      ws.emitOpen();
      ws.emitMessage({ type: ServerMessageType.CONNECTED, session_id: 'sess-1' });
      await expect(p).resolves.toBe('sess-1');
    });

    it('switchSession tears down the current socket and joins the other thread', async () => {
      const svc = new ChatService();
      const first = svc.connect();
      const ws1 = lastWs();
      ws1.emitOpen();
      ws1.emitMessage({ type: ServerMessageType.CONNECTED, session_id: 'sess-a' });
      await first;

      const second = svc.switchSession('sess-b');
      const ws2 = lastWs();
      expect(ws1.closed).not.toBeNull();
      expect(ws2.url).toMatch(/\/ws\/chat\/sess-b$/);
      ws2.emitOpen();
      ws2.emitMessage({ type: ServerMessageType.CONNECTED, session_id: 'sess-b' });
      await expect(second).resolves.toBe('sess-b');
      expect(svc.getSessionId()).toBe('sess-b');
    });

    it('a switched session still reconnects after a drop', async () => {
      // switchSession() calls disconnect(), which parks the machine in CLOSED to
      // suppress teardown reconnects. Failing to release that would leave the new
      // socket permanently un-retried.
      jest.useFakeTimers();
      const svc = new ChatService();
      const first = svc.connect();
      const ws1 = lastWs();
      ws1.emitOpen();
      ws1.emitMessage({ type: ServerMessageType.CONNECTED, session_id: 'sess-a' });
      await first;

      const second = svc.switchSession('sess-b');
      const ws2 = lastWs();
      ws2.emitOpen();
      ws2.emitMessage({ type: ServerMessageType.CONNECTED, session_id: 'sess-b' });
      await second;

      const before = FakeWebSocket.instances.length;
      ws2.emitClose(1006, '', false);
      jest.advanceTimersByTime(1000);
      expect(FakeWebSocket.instances.length).toBe(before + 1);
      expect(lastWs().url).toMatch(/\/ws\/chat\/sess-b$/);
    });

    it('reuses the open socket when asked for the session it already has', async () => {
      const svc = new ChatService();
      const p = svc.connect();
      const ws = lastWs();
      ws.emitOpen();
      ws.emitMessage({ type: ServerMessageType.CONNECTED, session_id: 'sess-a' });
      await p;

      const count = FakeWebSocket.instances.length;
      await expect(svc.connect('sess-a')).resolves.toBe('sess-a');
      expect(FakeWebSocket.instances.length).toBe(count);
    });
  });

  describe('stripSessionSegment', () => {
    it('removes a trailing new/uuid segment', () => {
      expect(stripSessionSegment('ws://h/ws/chat/new')).toBe('ws://h/ws/chat');
      expect(stripSessionSegment('ws://h/ws/chat/new/')).toBe('ws://h/ws/chat');
      expect(stripSessionSegment('ws://h/ws/chat/3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe(
        'ws://h/ws/chat'
      );
    });

    it('leaves a base URL alone', () => {
      expect(stripSessionSegment('ws://h/ws/chat')).toBe('ws://h/ws/chat');
      // "newsfeed" is not the literal segment `new`.
      expect(stripSessionSegment('ws://h/newsfeed')).toBe('ws://h/newsfeed');
      // A non-UUID trailing segment is someone's real path, not a session id.
      expect(stripSessionSegment('ws://h/ws/chat/v2')).toBe('ws://h/ws/chat/v2');
    });
  });

  it('connect resolves with the session id once CONNECTED arrives', async () => {
    const svc = new ChatService();
    const connected = jest.fn();
    svc.subscribe(CHAT_EVENTS.CONNECTED, connected);

    const sessionId = await Promise.resolve().then(async () => {
      const p = svc.connect();
      const ws = lastWs();
      ws.emitOpen();
      ws.emitMessage({ type: ServerMessageType.CONNECTED, session_id: 'abc' });
      return p;
    });

    expect(sessionId).toBe('abc');
    expect(svc.getSessionId()).toBe('abc');
    expect(svc.isConnected()).toBe(true);
    expect(connected).toHaveBeenCalledWith({ sessionId: 'abc' });
  });

  describe('server message dispatch', () => {
    it('TOKEN publishes content to subscribers', async () => {
      const svc = new ChatService();
      const token = jest.fn();
      svc.subscribe(CHAT_EVENTS.TOKEN, token);
      const ws = await connect(svc);
      ws.emitMessage({ type: ServerMessageType.TOKEN, content: 'hi' });
      expect(token).toHaveBeenCalledWith({ content: 'hi' });
    });

    it('THINKING_TOKEN, DONE, PREPROCESSING and ERROR map to events', async () => {
      const svc = new ChatService();
      const thinking = jest.fn();
      const done = jest.fn();
      const pre = jest.fn();
      const err = jest.fn();
      svc.subscribe(CHAT_EVENTS.THINKING_TOKEN, thinking);
      svc.subscribe(CHAT_EVENTS.MESSAGE_COMPLETE, done);
      svc.subscribe(CHAT_EVENTS.PREPROCESSING, pre);
      svc.subscribe(CHAT_EVENTS.ERROR, err);
      const ws = await connect(svc);

      ws.emitMessage({ type: ServerMessageType.THINKING_TOKEN, content: 'reasoning' });
      ws.emitMessage({ type: ServerMessageType.DONE });
      ws.emitMessage({ type: ServerMessageType.PREPROCESSING, content: 'loading', progress: 42 });
      ws.emitMessage({ type: ServerMessageType.ERROR, content: 'server boom' });

      expect(thinking).toHaveBeenCalledWith({ content: 'reasoning' });
      expect(done).toHaveBeenCalledWith({});
      expect(pre).toHaveBeenCalledWith({ status: 'loading', progress: 42 });
      expect(err).toHaveBeenCalledWith({ error: 'server boom' });
    });

    it('malformed JSON does not throw and does not notify subscribers', async () => {
      const svc = new ChatService();
      const token = jest.fn();
      svc.subscribe(CHAT_EVENTS.TOKEN, token);
      const ws = await connect(svc);
      expect(() => ws.emitRaw('not-json')).not.toThrow();
      expect(token).not.toHaveBeenCalled();
    });
  });

  describe('sendMessage', () => {
    it('sends a CHAT frame when connected', async () => {
      const svc = new ChatService();
      const ws = await connect(svc);
      ws.sent = [];
      svc.sendMessage('hello', 'study-9', ['series-1']);
      expect(ws.sent).toHaveLength(1);
      expect(JSON.parse(ws.sent[0])).toEqual({
        type: ClientMessageType.CHAT,
        content: 'hello',
        study_uid: 'study-9',
        series_uids: ['series-1'],
      });
    });

    it('publishes ERROR and sends nothing when not connected', () => {
      const svc = new ChatService();
      const err = jest.fn();
      svc.subscribe(CHAT_EVENTS.ERROR, err);
      svc.sendMessage('hello');
      expect(err).toHaveBeenCalledWith({ error: 'Not connected' });
    });
  });

  describe('cancelGeneration', () => {
    it('sends a CANCEL frame when connected', async () => {
      const svc = new ChatService();
      const ws = await connect(svc);
      ws.sent = [];
      svc.cancelGeneration();
      expect(JSON.parse(ws.sent[0])).toEqual({ type: ClientMessageType.CANCEL });
    });

    it('does nothing when not connected', () => {
      const svc = new ChatService();
      expect(() => svc.cancelGeneration()).not.toThrow();
    });
  });

  describe('close handling and reconnect', () => {
    it('publishes DISCONNECTED on close', async () => {
      const svc = new ChatService();
      const disc = jest.fn();
      svc.subscribe(CHAT_EVENTS.DISCONNECTED, disc);
      const ws = await connect(svc);
      ws.emitClose(1001, 'bye', true);
      expect(disc).toHaveBeenCalledWith({ code: 1001, reason: 'bye' });
      expect(svc.getSessionId()).toBeNull();
    });

    it('schedules a reconnect on an unclean close (fake timers)', async () => {
      jest.useFakeTimers();
      const svc = new ChatService();
      const p = svc.connect();
      const ws = lastWs();
      ws.emitOpen();
      ws.emitMessage({ type: ServerMessageType.CONNECTED, session_id: 's' });
      await p;

      expect(FakeWebSocket.instances).toHaveLength(1);
      ws.emitClose(1006, '', false); // unclean -> reconnect scheduled
      jest.advanceTimersByTime(1000); // RECONNECT_INITIAL_DELAY
      expect(FakeWebSocket.instances).toHaveLength(2); // a new socket was created
    });

    it('reconnects to the SAME session rather than starting an empty one', async () => {
      // Regression: the URL used to be fixed at /ws/chat/new, so every dropped
      // socket handed back a fresh, empty server session while the panel kept
      // showing the old transcript — the model silently lost the conversation
      // with nothing in the UI to say so.
      jest.useFakeTimers();
      const svc = new ChatService();
      const p = svc.connect();
      const ws = lastWs();
      ws.emitOpen();
      ws.emitMessage({ type: ServerMessageType.CONNECTED, session_id: 'sess-42' });
      await p;
      expect(ws.url).toMatch(/\/ws\/chat\/new$/);

      ws.emitClose(1006, '', false);
      jest.advanceTimersByTime(1000);

      expect(lastWs().url).toMatch(/\/ws\/chat\/sess-42$/);
    });

    it('does not reconnect after an intentional disconnect', async () => {
      jest.useFakeTimers();
      const svc = new ChatService();
      const p = svc.connect();
      const ws = lastWs();
      ws.emitOpen();
      ws.emitMessage({ type: ServerMessageType.CONNECTED, session_id: 's' });
      await p;

      svc.disconnect();
      // disconnect() closes the socket, which now drives onclose itself.
      jest.advanceTimersByTime(60000);
      expect(FakeWebSocket.instances).toHaveLength(1); // no new socket
    });

    it('connect timeout rejects when the socket never opens', async () => {
      jest.useFakeTimers();
      const svc = new ChatService();
      const p = svc.connect();
      const expectation = expect(p).rejects.toThrow('Connection timeout');
      jest.advanceTimersByTime(10000);
      await expectation;
    });
  });

  describe('subscribe / unsubscribe / destroy', () => {
    it('unsubscribe stops further notifications', async () => {
      const svc = new ChatService();
      const token = jest.fn();
      const sub = svc.subscribe(CHAT_EVENTS.TOKEN, token);
      const ws = await connect(svc);

      ws.emitMessage({ type: ServerMessageType.TOKEN, content: 'a' });
      expect(token).toHaveBeenCalledTimes(1);

      sub.unsubscribe();
      ws.emitMessage({ type: ServerMessageType.TOKEN, content: 'b' });
      expect(token).toHaveBeenCalledTimes(1);
    });

    it('an error in one subscriber does not block others', async () => {
      const svc = new ChatService();
      const good = jest.fn();
      svc.subscribe(CHAT_EVENTS.TOKEN, () => {
        throw new Error('x');
      });
      svc.subscribe(CHAT_EVENTS.TOKEN, good);
      const ws = await connect(svc);
      ws.emitMessage({ type: ServerMessageType.TOKEN, content: 'a' });
      expect(good).toHaveBeenCalledTimes(1);
    });

    it('destroy clears listeners and disconnects', async () => {
      const svc = new ChatService();
      const token = jest.fn();
      svc.subscribe(CHAT_EVENTS.TOKEN, token);
      const ws = await connect(svc);

      svc.destroy();
      expect(svc.getSessionId()).toBeNull();
      expect(ws.closed).toEqual({ code: 1000, reason: 'Client disconnect' });

      // Listeners are gone: re-publishing via a fresh socket message is moot,
      // but verify subscribe map was cleared by re-driving a message.
      ws.emitMessage({ type: ServerMessageType.TOKEN, content: 'late' });
      expect(token).not.toHaveBeenCalled();
    });
  });
});

describe('ChatService connect settling', () => {
  it('rejects on the 10s timeout when the socket opens but no CONNECTED arrives', async () => {
    jest.useFakeTimers();
    const svc = new ChatService();
    const p = svc.connect();
    const ws = lastWs();
    ws.emitOpen(); // OPEN, but the middleware never sends CONNECTED
    const assertion = expect(p).rejects.toThrow('Connection timeout');
    jest.advanceTimersByTime(10000);
    await assertion;
    expect(svc.isConnected()).toBe(false);
  });

  it('rejects when the socket closes before the session handshake', async () => {
    const svc = new ChatService();
    const p = svc.connect();
    lastWs().emitClose(1006, 'boom', false);
    await expect(p).rejects.toThrow(/closed before session/i);
    svc.disconnect(); // clear any armed reconnect timer
  });

  it('rejects when the socket errors before the session handshake', async () => {
    const svc = new ChatService();
    const p = svc.connect();
    lastWs().emitError();
    await expect(p).rejects.toThrow('Connection error');
    svc.disconnect();
  });

  it('reuses the in-flight connection promise instead of opening a second socket', async () => {
    const svc = new ChatService();
    const p1 = svc.connect();
    const p2 = svc.connect(); // called again while still CONNECTING
    expect(p2).toBe(p1);
    expect(FakeWebSocket.instances.length).toBe(1);
    const ws = lastWs();
    ws.emitOpen();
    ws.emitMessage({ type: ServerMessageType.CONNECTED, session_id: 's' });
    await p1;
  });

  it('returns immediately for an already-established connection without a new socket', async () => {
    const svc = new ChatService();
    await connect(svc, 's1');
    const before = FakeWebSocket.instances.length;
    await expect(svc.connect()).resolves.toBe('s1');
    expect(FakeWebSocket.instances.length).toBe(before);
  });
});

describe('ChatService connection state machine', () => {
  it('starts DISCONNECTED and becomes CONNECTING then CONNECTED', async () => {
    const svc = new ChatService();
    expect(svc.getConnectionState()).toBe(ChatConnectionState.DISCONNECTED);

    const p = svc.connect();
    expect(svc.getConnectionState()).toBe(ChatConnectionState.CONNECTING);

    const ws = lastWs();
    ws.emitOpen();
    // Still CONNECTING until the session handshake completes.
    expect(svc.getConnectionState()).toBe(ChatConnectionState.CONNECTING);
    ws.emitMessage({ type: ServerMessageType.CONNECTED, session_id: 's' });
    await p;
    expect(svc.getConnectionState()).toBe(ChatConnectionState.CONNECTED);
  });

  it('returns to DISCONNECTED after a clean close but RECONNECTING after an unclean one', async () => {
    jest.useFakeTimers();
    const svc = new ChatService();
    const p = svc.connect();
    const ws = lastWs();
    ws.emitOpen();
    ws.emitMessage({ type: ServerMessageType.CONNECTED, session_id: 's' });
    await p;

    ws.emitClose(1006, '', false); // unclean
    expect(svc.getConnectionState()).toBe(ChatConnectionState.RECONNECTING);
    jest.advanceTimersByTime(1000);
    expect(svc.getConnectionState()).toBe(ChatConnectionState.CONNECTING);
    svc.disconnect();
  });

  it('a CONNECTED frame without a session id does not complete the handshake', async () => {
    const svc = new ChatService();
    svc.connect().catch(() => {});
    const ws = lastWs();
    ws.emitOpen();
    ws.emitMessage({ type: ServerMessageType.CONNECTED }); // no session_id
    expect(svc.getConnectionState()).toBe(ChatConnectionState.CONNECTING);
    expect(svc.isConnected()).toBe(false);
    ws.close();
  });

  it('disconnect() moves to CLOSED and suppresses reconnect', async () => {
    const svc = new ChatService();
    const ws = await connect(svc);
    svc.disconnect();
    expect(svc.getConnectionState()).toBe(ChatConnectionState.CLOSED);
    expect(ws.closed).toEqual({ code: 1000, reason: 'Client disconnect' });
  });
});

describe('ChatService synchronous construction failure (P3)', () => {
  it('clears the cached promise when WebSocket construction throws, allowing a later retry', async () => {
    const svc = new ChatService();
    let throwOnce = true;
    const ThrowingWS: any = function (url: string) {
      if (throwOnce) {
        throwOnce = false;
        throw new Error('bad url');
      }
      return new FakeWebSocket(url);
    };
    ThrowingWS.OPEN = FakeWebSocket.OPEN;
    (global as any).WebSocket = ThrowingWS;

    // First attempt: construction throws synchronously -> promise rejects.
    await expect(svc.connect()).rejects.toThrow('bad url');
    // The machine must not be left stuck in CONNECTING after a synchronous
    // construction failure (no socket exists to drive it out of that state).
    expect(svc.getConnectionState()).toBe(ChatConnectionState.DISCONNECTED);

    // The rejected in-flight promise must not stay cached: a later connect()
    // creates a fresh socket instead of returning the same rejection.
    const p = svc.connect();
    const ws = lastWs();
    expect(ws).toBeInstanceOf(FakeWebSocket);
    ws.emitOpen();
    ws.emitMessage({ type: ServerMessageType.CONNECTED, session_id: 's2' });
    await expect(p).resolves.toBe('s2');
  });
});
