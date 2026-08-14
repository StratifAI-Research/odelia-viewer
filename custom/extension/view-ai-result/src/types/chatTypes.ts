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

/**
 * `event` is a transcript annotation the panel inserts itself — "Model changed
 * to MiniMax M3" — rather than anything a participant said. It exists so that a
 * mid-conversation configuration change stays visible in scrollback: without it,
 * two answers from different models would be indistinguishable after the fact.
 */
export type ChatRole = 'user' | 'assistant' | 'system' | 'event';

/** Which LLM backend the middleware routes chat to. */
export type ProviderName = 'local' | 'cloud';

/** One series as it was attached to a message. */
export interface SnapshotSeries {
  seriesInstanceUID: string;
  description: string;
  modality: string;
  numFrames: number;
}

/** The slice-selection recipe in force for a message. */
export interface SliceRecipe {
  numSlices: number;
  strategy: string;
  /** Only meaningful for the `central` strategy. */
  centralPercentage?: number;
}

/**
 * An immutable record of what one message was sent with.
 *
 * Captured at send time and never recomputed. This is the panel's core safety
 * property: the association between a question, the images it was asked about,
 * and the model that answered must not depend on what the main viewport happens
 * to display later. A radiologist who opens a different patient and scrolls back
 * must still see the original context.
 *
 * Note `requestedImageCount` is a bound on what was sent, not a report of what
 * arrived — see `utils/promptContext.ts`.
 */
export interface PromptContextSnapshot {
  studyInstanceUID: string;
  /** Pre-formatted study label (date · description), resolved at send time. */
  studyLabel: string;
  series: SnapshotSeries[];
  provider: ProviderName;
  /** The full model tag, verbatim — quantization included, for audit. */
  model: string;
  sliceRecipe: SliceRecipe;
  /** Upper bound on images sent; the middleware may clamp to volume depth. */
  requestedImageCount: number;
}

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
  /**
   * Immutable context this message was sent with. Set on the user message and
   * on the assistant message answering it, so either side of an exchange can be
   * traced back to its source images without walking the transcript.
   */
  promptContext?: PromptContextSnapshot;
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
