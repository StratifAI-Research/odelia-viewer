/**
 * TypeScript types for the AI Chat feature
 * Mirrors backend models from chat-middleware/models.py
 */

// =============================================================================
// Enums - Mirror backend enums
// =============================================================================

export enum ClientMessageType {
  CHAT = 'chat',
  CANCEL = 'cancel',
}

export enum ServerMessageType {
  CONNECTED = 'connected',
  TOKEN = 'token',
  THINKING_TOKEN = 'thinking_token',
  DONE = 'done',
  ERROR = 'error',
  PREPROCESSING = 'preprocessing',
}

// =============================================================================
// WebSocket Messages - Mirror backend Pydantic models
// =============================================================================

/**
 * Message sent from client to server via WebSocket
 */
export interface ClientMessage {
  type: ClientMessageType;
  content?: string;
  study_uid?: string;
  series_uids?: string[];
}

/**
 * Message received from server via WebSocket
 */
export interface ServerMessage {
  type: ServerMessageType;
  content?: string;
  session_id?: string;
  progress?: number;
}

// =============================================================================
// Frontend-specific types
// =============================================================================

export type ChatRole = 'user' | 'assistant' | 'system';

/**
 * A single chat message for display
 */
export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  timestamp: Date;
  /** Optional internal reasoning / thinking trace (assistant messages only) */
  thinking?: string;
  /** Series UIDs included as context for this message (user messages only) */
  seriesContext?: string[];
  /** Whether this message is still being streamed */
  isStreaming?: boolean;
}

/**
 * Series info for context selection (simplified from SeriesSelector)
 */
export interface ChatSeriesInfo {
  SeriesInstanceUID: string;
  SeriesDescription: string;
  SeriesNumber: number;
  Modality: string;
  numImageFrames: number;
}

/**
 * Chat service events
 */
export const CHAT_EVENTS = {
  CONNECTED: 'CHAT_CONNECTED',
  DISCONNECTED: 'CHAT_DISCONNECTED',
  TOKEN: 'CHAT_TOKEN',
  THINKING_TOKEN: 'CHAT_THINKING_TOKEN',
  MESSAGE_COMPLETE: 'CHAT_MESSAGE_COMPLETE',
  ERROR: 'CHAT_ERROR',
  PREPROCESSING: 'CHAT_PREPROCESSING',
} as const;

export type ChatEventType = (typeof CHAT_EVENTS)[keyof typeof CHAT_EVENTS];
