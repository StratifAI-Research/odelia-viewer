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
 * Which slices of one series a message sends, as the middleware receives it.
 *
 * Slices are named by SOPInstanceUID rather than by index: the viewer sorts a
 * series by ImagePositionPatient, the middleware rebuilds it with GDCM's own
 * geometric sort, and an index would mean different pixels on the day the two
 * disagree. `range_*` is audit metadata — the middleware selects nothing from it.
 */
export interface WireSliceSelection {
  series_uid: string;
  sop_instance_uids: string[];
  range_start?: number;
  range_end?: number;
  total_slices?: number;
  /**
   * The recipe to apply when this series cannot be addressed instance by
   * instance. Sent with the message so the middleware uses the recipe the panel
   * is displaying: its runtime config is global and mutable, so another browser
   * changing it between compose and send would otherwise rewrite this request
   * and leave the snapshot describing something that never happened.
   *
   * Ignored by the middleware when `sop_instance_uids` is non-empty.
   */
  num_slices?: number;
  slice_strategy?: string;
  central_percentage?: number;
}

/**
 * Message sent from client to server via WebSocket
 */
export interface ClientMessage {
  type: ClientMessageType;
  content?: string;
  study_uid?: string;
  series_uids?: string[];
  slice_selections?: WireSliceSelection[];
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
  /**
   * OHIF's identity for the attached images. Distinct from the series UID
   * because OHIF splits some series into several display sets (one per instance
   * for mammography and other single-image modalities), and two of them can
   * legitimately appear in one message.
   */
  displaySetInstanceUID: string;
  seriesInstanceUID: string;
  description: string;
  modality: string;
  numFrames: number;
  /**
   * The 1-based inclusive slice range selected for this series, and the slice
   * numbers sampled from it — recorded only when the series could be addressed
   * instance by instance, so their presence is itself the record that the slices
   * named here are the slices that were sent.
   *
   * Absent means the middleware's configured recipe applied instead, which is
   * why the snapshot renders a strategy in that case and a slice list in this one.
   */
  rangeStart?: number;
  rangeEnd?: number;
  sentSliceNumbers?: number[];
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
  /**
   * The turn ended in an error with nothing generated.
   *
   * The snapshot still describes the request faithfully, but a reader must not
   * take it as a record of an answer that was produced from those images —
   * possibly nothing was ever sent. Rendered next to the provenance for exactly
   * that reason.
   */
  deliveryFailed?: boolean;
}

/**
 * Series info for context selection (simplified from SeriesSelector)
 */
export interface ChatSeriesInfo {
  /** OHIF's identity for this set of images; the panel keys its state on it. */
  displaySetInstanceUID: string;
  SeriesInstanceUID: string;
  SeriesDescription: string;
  SeriesNumber: number;
  Modality: string;
  numImageFrames: number;
  /**
   * SOPInstanceUIDs in the viewer's own slice order — the addresses a slice range
   * is expressed in. Empty when the series holds no one-instance-per-slice
   * mapping (a multi-frame instance), in which case a range cannot be expressed
   * for it at all and the middleware's configured recipe applies instead.
   */
  sopInstanceUIDs: string[];
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
