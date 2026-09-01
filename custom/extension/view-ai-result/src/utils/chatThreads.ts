/**
 * Client-side store for chat threads, so a user can keep several conversations
 * about a study and switch between them.
 *
 * WHY THE TRANSCRIPT LIVES HERE AND NOT ON THE SERVER
 *
 * The middleware does keep per-session conversation history, but it is not a
 * usable source for the panel:
 *
 *   - It stores the *prompt* form, in which each user turn is an interleaved
 *     content array carrying the slice images as base64 data URIs. Serving that
 *     back would push megabytes of patient imagery over `/chat-api/`, which is
 *     proxied without authentication.
 *   - It has no per-message provenance. The `PromptContextSnapshot` that every
 *     message carries is built in the browser at send time and exists nowhere
 *     else, so a server-restored transcript would lose exactly the traceability
 *     the panel was restructured to provide.
 *
 * So the browser owns what is *displayed* and the middleware owns what the model
 * *remembers*. The two are joined by `serverSessionId`. They can fall out of
 * step — the middleware keeps sessions in memory only, so a restart drops them —
 * and the panel must say so rather than present a transcript the model has no
 * knowledge of. See `ChatPanel`'s server-memory notice.
 *
 * STORAGE
 *
 * `sessionStorage`, not `localStorage`. Transcripts contain AI statements about
 * a named patient's imaging plus study identifiers; on a shared clinical
 * workstation `localStorage` would leave that at rest for whoever sits down
 * next. `sessionStorage` survives a reload — the case that actually annoys
 * people — and is discarded when the tab closes.
 */

import type { ChatMessage } from '../types/chatTypes';

/** Bumped if the persisted shape changes incompatibly; old keys are ignored. */
const STORAGE_KEY = 'odelia.chat.threads.v1';

/** Threads kept before the oldest are dropped. */
export const MAX_THREADS = 20;

/** Longest derived title before elision. */
const MAX_TITLE_LEN = 48;

export const NEW_THREAD_TITLE = 'New chat';

export interface ChatThread {
  id: string;
  /** Derived from the first user message; recomputed while none exists. */
  title: string;
  createdAt: number;
  updatedAt: number;
  /**
   * The middleware session this thread's history belongs to. Null until the
   * socket has completed a handshake for it.
   */
  serverSessionId: string | null;
  messages: ChatMessage[];
}

/** Minimal Storage surface, so tests need no jsdom storage. */
export interface ThreadStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

let threadSeq = 0;
/**
 * Thread ids are local display keys, never sent anywhere, so a counter plus the
 * clock is sufficient and avoids depending on `crypto.randomUUID` being present.
 */
export function newThreadId(): string {
  threadSeq += 1;
  return `thread-${Date.now()}-${threadSeq}`;
}

export function createThread(overrides: Partial<ChatThread> = {}): ChatThread {
  const now = Date.now();
  return {
    id: newThreadId(),
    title: NEW_THREAD_TITLE,
    createdAt: now,
    updatedAt: now,
    serverSessionId: null,
    messages: [],
    ...overrides,
  };
}

/**
 * Title a thread from its first user turn.
 *
 * Only user messages are considered: an assistant turn opens with whatever the
 * model chose to say, and an `event` turn is panel metadata — neither describes
 * what the conversation is about.
 */
export function deriveThreadTitle(messages: ChatMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user' && m.content?.trim());
  if (!firstUser) {
    return NEW_THREAD_TITLE;
  }
  const flat = firstUser.content.replace(/\s+/g, ' ').trim();
  if (flat.length <= MAX_TITLE_LEN) {
    return flat;
  }
  return `${flat.slice(0, MAX_TITLE_LEN - 1).trimEnd()}…`;
}

/**
 * Coarse "how long ago" for the history list.
 *
 * Deliberately coarse: the exact minute a conversation was last touched is not
 * clinically meaningful, and a precise clock time invites confusion with the
 * study's own timestamps, which are shown elsewhere in DICOM's timezone-labelled
 * form. `now` is injectable so this is testable without freezing the clock.
 */
export function formatRelativeTime(timestamp: number, now: number = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - timestamp) / 60000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `${hours}h ago`;
  }
  return `${Math.floor(hours / 24)}d ago`;
}

/** Newest first — the order the history list is read in. */
export function sortThreads(threads: ChatThread[]): ChatThread[] {
  return [...threads].sort((a, b) => b.updatedAt - a.updatedAt);
}

/** Keep the newest `max`, dropping the least recently touched. */
export function pruneThreads(threads: ChatThread[], max: number = MAX_THREADS): ChatThread[] {
  return sortThreads(threads).slice(0, Math.max(0, max));
}

/** Insert or replace a thread, keeping the list newest-first and bounded. */
export function upsertThread(threads: ChatThread[], thread: ChatThread): ChatThread[] {
  const without = threads.filter(t => t.id !== thread.id);
  return pruneThreads([thread, ...without]);
}

export function removeThread(threads: ChatThread[], threadId: string): ChatThread[] {
  return threads.filter(t => t.id !== threadId);
}

/** A finite timestamp, or null when the value cannot be trusted. */
function reviveTimestamp(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return null;
}

/**
 * Rebuild one message from its stored form.
 *
 * `timestamp` is a `Date` in memory and an ISO string once persisted. An
 * unparseable one falls back to the thread's own `updatedAt` rather than
 * `Invalid Date`: an approximate time reads as approximate, whereas "Invalid
 * Date" in a clinical transcript reads as a defect.
 */
function reviveMessage(raw: any, fallbackTs: number): ChatMessage | null {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') {
    return null;
  }
  const ts = reviveTimestamp(raw.timestamp);
  return {
    ...raw,
    content: typeof raw.content === 'string' ? raw.content : '',
    timestamp: new Date(ts ?? fallbackTs),
    // Nothing is in flight after a reload; a message left mid-stream would
    // otherwise render its spinner forever.
    isStreaming: false,
  } as ChatMessage;
}

function reviveThread(raw: any): ChatThread | null {
  if (!raw || typeof raw !== 'object' || typeof raw.id !== 'string') {
    return null;
  }
  const createdAt = reviveTimestamp(raw.createdAt) ?? Date.now();
  const updatedAt = reviveTimestamp(raw.updatedAt) ?? createdAt;
  const messages = Array.isArray(raw.messages)
    ? (raw.messages.map((m: any) => reviveMessage(m, updatedAt)).filter(Boolean) as ChatMessage[])
    : [];
  return {
    id: raw.id,
    title: typeof raw.title === 'string' && raw.title ? raw.title : NEW_THREAD_TITLE,
    createdAt,
    updatedAt,
    serverSessionId: typeof raw.serverSessionId === 'string' ? raw.serverSessionId : null,
    messages,
  };
}

/**
 * Parse persisted threads. Never throws: storage is shared with other tabs and
 * older builds, so anything unreadable is treated as "no history" rather than
 * being allowed to break the panel's first render.
 */
export function parseThreads(raw: string | null): ChatThread[] {
  if (!raw) {
    return [];
  }
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    return sortThreads(parsed.map(reviveThread).filter(Boolean) as ChatThread[]);
  } catch (_) {
    return [];
  }
}

export function loadThreads(storage?: ThreadStorage | null): ChatThread[] {
  const store = storage ?? defaultStorage();
  if (!store) {
    return [];
  }
  try {
    return parseThreads(store.getItem(STORAGE_KEY));
  } catch (_) {
    // Storage can throw outright when disabled by browser policy.
    return [];
  }
}

/**
 * Persist threads, returning what was actually written.
 *
 * On a quota failure the oldest threads are shed and the write retried, so a
 * long transcript degrades to fewer threads instead of silently persisting
 * nothing.
 */
export function saveThreads(threads: ChatThread[], storage?: ThreadStorage | null): ChatThread[] {
  const store = storage ?? defaultStorage();
  const bounded = pruneThreads(threads);
  if (!store) {
    return bounded;
  }
  let attempt = bounded;
  for (let i = 0; i < 3; i++) {
    try {
      store.setItem(STORAGE_KEY, JSON.stringify(attempt));
      return attempt;
    } catch (_) {
      if (attempt.length <= 1) {
        return attempt;
      }
      attempt = attempt.slice(0, Math.ceil(attempt.length / 2));
    }
  }
  return attempt;
}

function defaultStorage(): ThreadStorage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch (_) {
    // Accessing sessionStorage throws when storage is blocked by policy.
    return null;
  }
}
