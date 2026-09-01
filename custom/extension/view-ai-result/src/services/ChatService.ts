/**
 * ChatService - Manages WebSocket connection to chat-middleware
 * Handles message streaming, reconnection, and event pub/sub
 *
 * The connection lifecycle is modelled as an explicit state machine
 * ({@link ChatConnectionState}) rather than a set of independent booleans /
 * readyState checks. Every transition goes through {@link setState}, and the
 * reconnect decision and `isConnected()` derive from the current state. A
 * connect attempt settles exactly once.
 */
import {
  ClientMessage,
  ClientMessageType,
  ServerMessage,
  ServerMessageType,
  CHAT_EVENTS,
  ChatEventType,
  WireSliceSelection,
} from '../types/chatTypes';
import { EventfulService } from './EventfulService';

// Reconnection settings
const RECONNECT_INITIAL_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;
const RECONNECT_MULTIPLIER = 2;
const CONNECT_TIMEOUT_MS = 10000;

/**
 * Connection lifecycle states.
 *
 *   DISCONNECTED ──connect()──▶ CONNECTING ──CONNECTED msg──▶ CONNECTED
 *        ▲                          │                             │
 *        │                    error/close/timeout          unclean close
 *        │                          │                             │
 *        └──────────────────────────┴────────────┬────────────────┘
 *                                                 ▼
 *                                          RECONNECTING ──timer──▶ CONNECTING
 *
 * disconnect()/destroy() moves to CLOSED from any state and suppresses reconnect.
 */
export enum ChatConnectionState {
  DISCONNECTED = 'DISCONNECTED',
  CONNECTING = 'CONNECTING',
  CONNECTED = 'CONNECTED',
  RECONNECTING = 'RECONNECTING',
  CLOSED = 'CLOSED',
}

/**
 * Drop a trailing session segment from a configured WebSocket URL.
 *
 * `chatMiddleware.wsUrl` used to be the complete URL, so deployments may have it
 * set to `…/ws/chat/new`. The session id is now chosen per connect, and that
 * literal `new` would defeat resuming a conversation, so it is stripped. Only a
 * segment that plausibly *is* a session id is removed — `new` or a UUID — so an
 * override pointing at some other path is left intact.
 */
export function stripSessionSegment(url: string): string {
  return url.replace(
    /\/(new|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\/*$/i,
    ''
  );
}

export class ChatService extends EventfulService<ChatEventType> {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  /**
   * The session to reconnect to. Distinct from `sessionId`, which is cleared on
   * close: after a drop we must resume the SAME server session, not start a new
   * one, or the model silently forgets the conversation still on screen.
   */
  private resumeSessionId: string | null = null;
  private connectPromise: Promise<string> | null = null;
  private wsUrl: string;
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private state: ChatConnectionState = ChatConnectionState.DISCONNECTED;

  // Event constants - instance access
  static EVENTS = CHAT_EVENTS;
  EVENTS = CHAT_EVENTS;

  constructor() {
    super();
    // Try to get WebSocket URL from config, fallback to derived URL
    this.wsUrl = this.getWebSocketUrl();
  }

  /** Current connection lifecycle state. */
  getConnectionState(): ChatConnectionState {
    return this.state;
  }

  private setState(next: ChatConnectionState): void {
    this.state = next;
  }

  /**
   * Base WebSocket URL, WITHOUT the trailing session segment.
   *
   * The endpoint is `/ws/chat/{session_id}`, and the id is chosen per connect —
   * `new` for a fresh conversation, an existing id to resume one. A configured
   * override may still carry a trailing `/new` (or a session id) from when this
   * was a fixed URL; that segment is stripped so the override keeps working.
   */
  private getWebSocketUrl(): string {
    try {
      const config = (window as any)?.config;
      // Allow explicit override via config
      if (config?.chatMiddleware?.wsUrl) {
        return stripSessionSegment(config.chatMiddleware.wsUrl);
      }
    } catch (e) {
      console.warn('[ChatService] Error getting config:', e);
    }

    // Dev-server fallback: `pnpm run dev` serves the viewer on :3000 with the
    // chat middleware running separately on :5560 and no proxy in between.
    //
    // The NODE_ENV guard matters. Webpack replaces it with a literal, so this
    // branch is eliminated from a production bundle entirely — without it, the
    // published image would match the host/port check whenever it is run the
    // way the README documents (`docker run -p 3000:80`) and point chat at a
    // middleware that is not there. Set `chatMiddleware.wsUrl` in app-config.js
    // to override in any deployment that is not simply proxying /ws.
    if (
      process.env.NODE_ENV !== 'production' &&
      window.location.hostname === 'localhost' &&
      window.location.port === '3000'
    ) {
      return 'ws://localhost:5560/ws/chat';
    }

    // Proxied deployment: same origin as the viewer.
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/chat`;
  }

  /** The session id the next socket should target. */
  private nextSessionTarget(explicit?: string | null): string {
    if (explicit) {
      return explicit;
    }
    // Resume rather than start over. Without this, an unclean drop reconnects to
    // `new` and the middleware hands back a fresh, EMPTY session while the panel
    // still shows the old transcript — the model would silently lose every
    // earlier turn with nothing in the UI to say so.
    return this.resumeSessionId ?? 'new';
  }

  /**
   * Connect to the WebSocket server.
   *
   * @param sessionId Session to join. Omit to resume the current session (or
   *   start a new one if there is none); pass `'new'` to force a fresh session.
   */
  connect(sessionId?: string | null): Promise<string> {
    // Reuse a fully-established connection — unless a *different* session was
    // asked for, which has to tear the socket down and re-handshake.
    if (this.state === ChatConnectionState.CONNECTED && this.sessionId) {
      if (!sessionId || sessionId === this.sessionId) {
        return Promise.resolve(this.sessionId);
      }
      return this.switchSession(sessionId);
    }
    // Reuse an in-flight connection rather than opening a competing socket. A
    // manual "Reconnect" racing a scheduled reconnect (or two callers awaiting
    // connect at once) would otherwise overwrite this.ws and orphan the previous
    // socket + its handlers.
    if (this.connectPromise) {
      return this.connectPromise;
    }

    const target = this.nextSessionTarget(sessionId);
    // Remember the intent now: if the socket drops mid-handshake, the scheduled
    // reconnect must aim at the same session rather than fall back to `new`.
    this.resumeSessionId = target === 'new' ? null : target;
    const url = `${this.wsUrl}/${target}`;

    const promise = new Promise<string>((resolve, reject) => {
      // Detach and close any superseded socket before opening a new one.
      if (this.ws) {
        this.ws.onopen = this.ws.onmessage = this.ws.onerror = this.ws.onclose = null;
        try {
          this.ws.close();
        } catch {
          /* ignore */
        }
        this.ws = null;
      }

      this.setState(ChatConnectionState.CONNECTING);
      let settled = false;
      let ws: WebSocket;
      try {
        ws = new WebSocket(url);
      } catch (err) {
        // The WebSocket constructor threw synchronously (e.g. a malformed
        // configured wsUrl). No socket exists, so no onerror/onclose handler
        // will ever fire — reset the machine to DISCONNECTED rather than leaving
        // getConnectionState() stuck at CONNECTING. connectPromise is released by
        // the promise.catch() guard below so a later connect() can retry.
        this.setState(ChatConnectionState.DISCONNECTED);
        throw err;
      }
      this.ws = ws;

      // Settle the connection promise exactly once, clearing the timeout and
      // releasing the in-flight guard, so a socket that opens but never sends
      // CONNECTED (or errors/closes before the handshake) can't leave connect()
      // pending forever.
      const settle = (action: () => void) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(connectionTimeout);
        this.connectPromise = null;
        action();
      };

      const connectionTimeout = setTimeout(() => {
        // Reject regardless of readyState: an OPEN socket that never sends a
        // CONNECTED frame must not leave connect() pending forever. Settle first
        // so the reported reason is the timeout, then close (its onclose is a
        // no-op once settled).
        settle(() => reject(new Error('Connection timeout')));
        try {
          ws.close();
        } catch {
          /* ignore */
        }
      }, CONNECT_TIMEOUT_MS);

      ws.onopen = () => {
        this.reconnectAttempts = 0;
      };

      ws.onmessage = event => {
        try {
          const message: ServerMessage = JSON.parse(event.data);
          this.handleServerMessage(message, sessionId => settle(() => resolve(sessionId)));
        } catch (e) {
          console.error('[ChatService] Error parsing message:', e);
        }
      };

      ws.onerror = error => {
        console.error('[ChatService] WebSocket error:', error);
        this.publish(CHAT_EVENTS.ERROR, { error: 'Connection error' });
        settle(() => reject(new Error('Connection error')));
      };

      ws.onclose = event => {
        this.sessionId = null;
        this.publish(CHAT_EVENTS.DISCONNECTED, { code: event.code, reason: event.reason });
        // If the socket closed before a session was established, fail the pending
        // connect (no-op once already settled by CONNECTED).
        settle(() =>
          reject(new Error(`Connection closed before session was established (code ${event.code})`))
        );

        // A deliberate disconnect()/destroy() has already moved us to CLOSED;
        // never reconnect from there. Otherwise an unclean drop schedules a
        // reconnect, and a clean close returns to DISCONNECTED.
        if (this.state === ChatConnectionState.CLOSED) {
          return;
        }
        if (!event.wasClean) {
          this.scheduleReconnect();
        } else {
          this.setState(ChatConnectionState.DISCONNECTED);
        }
      };
    });

    this.connectPromise = promise;
    // If the executor threw synchronously (e.g. `new WebSocket(malformedUrl)`),
    // settle() never ran to release the in-flight guard, leaving a rejected
    // promise cached that would block every later reconnect. Clear it so a
    // subsequent connect() retries. The identity guard avoids clobbering a newer
    // in-flight promise; settle() already nulls connectPromise on normal
    // rejections, so this is a no-op there.
    promise.catch(() => {
      if (this.connectPromise === promise) {
        this.connectPromise = null;
      }
    });

    return promise;
  }

  /**
   * Handle incoming server messages
   */
  private handleServerMessage(
    message: ServerMessage,
    resolveConnect?: (sessionId: string) => void
  ): void {
    switch (message.type) {
      case ServerMessageType.CONNECTED:
        this.sessionId = message.session_id || null;
        // The handshake is only complete once we have a session id.
        if (this.sessionId) {
          this.setState(ChatConnectionState.CONNECTED);
          // The server assigns the id when we ask for `new`; record it so a
          // later reconnect resumes this conversation.
          this.resumeSessionId = this.sessionId;
        }
        this.publish(CHAT_EVENTS.CONNECTED, { sessionId: this.sessionId });
        if (resolveConnect && this.sessionId) {
          resolveConnect(this.sessionId);
        }
        break;

      case ServerMessageType.TOKEN:
        this.publish(CHAT_EVENTS.TOKEN, { content: message.content });
        break;

      case ServerMessageType.THINKING_TOKEN:
        this.publish(CHAT_EVENTS.THINKING_TOKEN, { content: message.content });
        break;

      case ServerMessageType.DONE:
        this.publish(CHAT_EVENTS.MESSAGE_COMPLETE, {});
        break;

      case ServerMessageType.ERROR:
        console.error('[ChatService] Server error:', message.content);
        this.publish(CHAT_EVENTS.ERROR, { error: message.content });
        break;

      case ServerMessageType.PREPROCESSING:
        this.publish(CHAT_EVENTS.PREPROCESSING, {
          status: message.content,
          progress: message.progress,
        });
        break;

      default:
        console.warn('[ChatService] Unknown message type:', message.type);
    }
  }

  /**
   * Schedule a reconnection attempt with exponential backoff
   */
  private scheduleReconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
    }

    this.setState(ChatConnectionState.RECONNECTING);

    const delay = Math.min(
      RECONNECT_INITIAL_DELAY * Math.pow(RECONNECT_MULTIPLIER, this.reconnectAttempts),
      RECONNECT_MAX_DELAY
    );

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectTimeout = null;
      this.reconnectAttempts++;
      this.connect().catch(e => {
        console.error('[ChatService] Reconnect failed:', e);
      });
    }, delay);
  }

  /**
   * Send a chat message
   */
  sendMessage(
    content: string,
    studyUID?: string,
    seriesUIDs?: string[],
    sliceSelections?: WireSliceSelection[]
  ): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.publish(CHAT_EVENTS.ERROR, { error: 'Not connected' });
      return;
    }

    const message: ClientMessage = {
      type: ClientMessageType.CHAT,
      content,
      study_uid: studyUID,
      series_uids: seriesUIDs,
      // Omitted rather than sent empty: an absent field and an empty list mean the
      // same thing to the middleware, and omitting keeps the frame legible.
      slice_selections: sliceSelections?.length ? sliceSelections : undefined,
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Cancel current generation
   */
  cancelGeneration(): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }

    const message: ClientMessage = {
      type: ClientMessageType.CANCEL,
    };

    this.ws.send(JSON.stringify(message));
  }

  /**
   * Join a different conversation, tearing down the current socket first.
   *
   * @param sessionId An existing middleware session, or `'new'` for a fresh one.
   */
  switchSession(sessionId: string): Promise<string> {
    this.disconnect();
    // disconnect() parks the machine in CLOSED, which exists to suppress
    // reconnects during teardown. Release it, or connect() would open a socket
    // whose first drop is silently never retried.
    this.setState(ChatConnectionState.DISCONNECTED);
    this.resumeSessionId = sessionId === 'new' ? null : sessionId;
    return this.connect(sessionId);
  }

  /**
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    // Enter CLOSED before closing the socket so the onclose handler suppresses
    // any reconnect for this deliberate teardown.
    this.setState(ChatConnectionState.CLOSED);
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.sessionId = null;
    this.connectPromise = null;
  }

  /**
   * Get current session ID
   */
  getSessionId(): string | null {
    return this.sessionId;
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.state === ChatConnectionState.CONNECTED && this.sessionId !== null;
  }

  /**
   * Cleanup - call on unmount
   */
  destroy(): void {
    this.disconnect();
    this.clearListeners();
  }
}

declare global {
  namespace AppTypes {
    interface Services {
      chatService?: ChatService;
    }
  }
}
