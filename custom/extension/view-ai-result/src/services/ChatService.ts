/**
 * ChatService - Manages WebSocket connection to chat-middleware
 * Handles message streaming, reconnection, and event pub/sub
 */
import {
  ClientMessage,
  ClientMessageType,
  ServerMessage,
  ServerMessageType,
  CHAT_EVENTS,
  ChatEventType,
} from '../types/chatTypes';

// Reconnection settings
const RECONNECT_INITIAL_DELAY = 1000;
const RECONNECT_MAX_DELAY = 30000;
const RECONNECT_MULTIPLIER = 2;

export class ChatService {
  private ws: WebSocket | null = null;
  private sessionId: string | null = null;
  private wsUrl: string;
  private eventListeners: Map<string, Array<(data: any) => void>> = new Map();
  private reconnectAttempts = 0;
  private reconnectTimeout: ReturnType<typeof setTimeout> | null = null;
  private isIntentionalClose = false;

  // Event constants - instance access
  static EVENTS = CHAT_EVENTS;
  EVENTS = CHAT_EVENTS;

  constructor() {
    // Try to get WebSocket URL from config, fallback to derived URL
    this.wsUrl = this.getWebSocketUrl();
  }

  /**
   * Get WebSocket URL - derives from current location for proxied deployments
   */
  private getWebSocketUrl(): string {
    try {
      const config = (window as any)?.config;
      // Allow explicit override via config
      if (config?.chatMiddleware?.wsUrl) {
        return config.chatMiddleware.wsUrl;
      }
    } catch (e) {
      console.warn('[ChatService] Error getting config:', e);
    }

    // Derive WebSocket URL from current origin
    // This works for both development (localhost) and production (proxied through nginx)
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;

    // In development on localhost, use direct connection to chat-middleware
    if (window.location.hostname === 'localhost' && window.location.port === '3000') {
      return 'ws://localhost:5560/ws/chat/new';
    }

    // In production/proxied environment, use the proxied path
    return `${protocol}//${host}/ws/chat/new`;
  }

  /**
   * Connect to WebSocket server
   */
  connect(): Promise<string> {
    return new Promise((resolve, reject) => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        if (this.sessionId) {
          resolve(this.sessionId);
          return;
        }
      }

      this.isIntentionalClose = false;
      this.ws = new WebSocket(this.wsUrl);

      const connectionTimeout = setTimeout(() => {
        if (this.ws?.readyState !== WebSocket.OPEN) {
          this.ws?.close();
          reject(new Error('Connection timeout'));
        }
      }, 10000);

      this.ws.onopen = () => {
        console.log('[ChatService] WebSocket connected');
        this.reconnectAttempts = 0;
      };

      this.ws.onmessage = (event) => {
        try {
          const message: ServerMessage = JSON.parse(event.data);
          this.handleServerMessage(message, resolve);
        } catch (e) {
          console.error('[ChatService] Error parsing message:', e);
        }
      };

      this.ws.onerror = (error) => {
        console.error('[ChatService] WebSocket error:', error);
        clearTimeout(connectionTimeout);
        this.publish(CHAT_EVENTS.ERROR, { error: 'Connection error' });
      };

      this.ws.onclose = (event) => {
        console.log('[ChatService] WebSocket closed:', event.code, event.reason);
        clearTimeout(connectionTimeout);
        this.sessionId = null;
        this.publish(CHAT_EVENTS.DISCONNECTED, { code: event.code, reason: event.reason });

        // Attempt reconnection if not intentionally closed
        if (!this.isIntentionalClose && !event.wasClean) {
          this.scheduleReconnect();
        }
      };
    });
  }

  /**
   * Handle incoming server messages
   */
  private handleServerMessage(message: ServerMessage, resolveConnect?: (sessionId: string) => void): void {
    switch (message.type) {
      case ServerMessageType.CONNECTED:
        this.sessionId = message.session_id || null;
        console.log('[ChatService] Session established:', this.sessionId);
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

    const delay = Math.min(
      RECONNECT_INITIAL_DELAY * Math.pow(RECONNECT_MULTIPLIER, this.reconnectAttempts),
      RECONNECT_MAX_DELAY
    );

    console.log(`[ChatService] Scheduling reconnect in ${delay}ms (attempt ${this.reconnectAttempts + 1})`);

    this.reconnectTimeout = setTimeout(() => {
      this.reconnectAttempts++;
      this.connect().catch((e) => {
        console.error('[ChatService] Reconnect failed:', e);
      });
    }, delay);
  }

  /**
   * Send a chat message
   */
  sendMessage(content: string, studyUID?: string, seriesUIDs?: string[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      this.publish(CHAT_EVENTS.ERROR, { error: 'Not connected' });
      return;
    }

    const message: ClientMessage = {
      type: ClientMessageType.CHAT,
      content,
      study_uid: studyUID,
      series_uids: seriesUIDs,
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
   * Disconnect from WebSocket server
   */
  disconnect(): void {
    this.isIntentionalClose = true;
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close(1000, 'Client disconnect');
      this.ws = null;
    }
    this.sessionId = null;
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
    return this.ws?.readyState === WebSocket.OPEN && this.sessionId !== null;
  }

  /**
   * Subscribe to events
   */
  subscribe(eventName: ChatEventType, callback: (data: any) => void): { unsubscribe: () => void } {
    if (!this.eventListeners.has(eventName)) {
      this.eventListeners.set(eventName, []);
    }
    this.eventListeners.get(eventName)!.push(callback);

    return {
      unsubscribe: () => {
        const listeners = this.eventListeners.get(eventName);
        if (listeners) {
          const index = listeners.indexOf(callback);
          if (index > -1) {
            listeners.splice(index, 1);
          }
        }
      },
    };
  }

  /**
   * Publish events
   */
  private publish(eventName: ChatEventType, data: any): void {
    const listeners = this.eventListeners.get(eventName);
    if (listeners) {
      listeners.forEach((callback) => {
        try {
          callback(data);
        } catch (e) {
          console.error(`[ChatService] Error in event listener for ${eventName}:`, e);
        }
      });
    }
  }

  /**
   * Cleanup - call on unmount
   */
  destroy(): void {
    this.disconnect();
    this.eventListeners.clear();
  }
}
