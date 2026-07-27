/**
 * Feedback API client.
 *
 * The network + endpoint-derivation concerns that used to live inline in
 * `FeedbackPanel` (H-11). Keeping them here makes the panel's request/response
 * shape explicit and independently testable, and gives every caller one place
 * that builds the `/feedback` query and `/feedback/submit` body.
 */

// Derive Orthanc base path from app-config data source (qidoRoot like '/pacs/dicom-web').
export function deriveFeedbackApiBase(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cfg: any = (window as any)?.config;
    const dataSources = cfg?.dataSources || [];
    const dw = dataSources.find((ds: any) => ds?.configuration?.qidoRoot);
    const qidoRoot: string | undefined = dw?.configuration?.qidoRoot;
    if (qidoRoot && typeof qidoRoot === 'string') {
      const idx = qidoRoot.indexOf('/dicom-web');
      if (idx > 0) {
        return qidoRoot.slice(0, idx);
      }
      // if qidoRoot equals '/dicom-web', Orthanc is at root
      if (qidoRoot === '/dicom-web') return '';
      // otherwise use dirname as base
      const parts = qidoRoot.split('/').filter(Boolean);
      if (parts.length > 0) return `/${parts[0]}`;
    }
  } catch (_) {
    // ignore
  }
  // Fallback to same-origin root
  return '';
}

export const FEEDBACK_API_BASE = deriveFeedbackApiBase();

/** Identifies a single AI result for feedback storage/retrieval. */
export interface FeedbackResultKey {
  studyUID: string;
  modelName: string;
  modelVersion: string;
  resultTs: string;
}

export interface UserVerdict {
  user_id: string;
  verdict_L: number;
  verdict_R: number;
}

export interface FeedbackStatus {
  users?: UserVerdict[];
}

export interface SubmitFeedbackPayload {
  study_uid: string;
  model_name: string;
  model_version: string;
  result_ts: string;
  user_id: string;
  verdict_L: number;
  verdict_R: number;
  edited?: boolean;
}

function statusParams(key: FeedbackResultKey): string {
  return new URLSearchParams({
    study_uid: String(key.studyUID),
    model_name: String(key.modelName),
    model_version: String(key.modelVersion),
    result_ts: String(key.resultTs),
    includeUsers: 'true',
  }).toString();
}

/**
 * Fetch stored feedback for a result. Returns `null` on a non-OK response so
 * callers keep the UI functional; network/abort errors propagate to the caller.
 */
export async function fetchFeedbackStatus(
  key: FeedbackResultKey,
  signal?: AbortSignal
): Promise<FeedbackStatus | null> {
  const res = await fetch(`${FEEDBACK_API_BASE}/feedback?${statusParams(key)}`, { signal });
  if (!res.ok) {
    return null;
  }
  return res.json();
}

/** Find the current user's verdict in a status response, if present. */
export function findUserVerdict(status: FeedbackStatus | null, userId: string): UserVerdict | null {
  const users = status?.users;
  if (!Array.isArray(users)) {
    return null;
  }
  return users.find(x => x.user_id === userId) ?? null;
}

export interface SubmitResult {
  status: number;
  ok: boolean;
  text: () => Promise<string>;
}

/** POST a feedback verdict. */
export async function submitFeedback(payload: SubmitFeedbackPayload): Promise<SubmitResult> {
  return fetch(`${FEEDBACK_API_BASE}/feedback/submit`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
