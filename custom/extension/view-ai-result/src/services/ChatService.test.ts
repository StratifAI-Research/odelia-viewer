import { ChatService } from './ChatService';
import {
  CHAT_EVENTS,
  ClientMessageType,
  ServerMessageType,
} from '../types/chatTypes';

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

  it('honors an explicit wsUrl from window.config', () => {
    (window as any).config = { chatMiddleware: { wsUrl: 'ws://custom/ws' } };
    const svc = new ChatService();
    svc.connect();
    const ws = lastWs();
    expect(ws.url).toBe('ws://custom/ws');
    // Tear the socket down so the 10s connection timeout armed by connect() is
    // cleared (via onclose) instead of leaking as an open handle.
    ws.close();
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
      svc.subscribe(CHAT_EVENTS.TOKEN, () => { throw new Error('x'); });
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
