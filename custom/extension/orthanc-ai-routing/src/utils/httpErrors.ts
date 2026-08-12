/**
 * User-facing failure messages for the Orthanc / AI HTTP calls.
 *
 * The routing panel renders these strings verbatim, so they must stay short,
 * free of markup and actionable. Two failures dominate when no AI backend is
 * attached, and both used to read badly:
 *
 *   - nothing is listening on `orthancUrl` — `fetch` rejects with a bare
 *     "Failed to fetch", which tells the reader nothing about what to do;
 *   - something *is* listening but it is not Orthanc — typically the viewer's
 *     own dev server, which answers unknown routes with an HTML 404 page. That
 *     page was pasted straight into the message, so the panel showed a wall of
 *     `<!DOCTYPE html>…<pre>Cannot POST /tools/lookup</pre>`.
 */

/** Shared timeout for every Orthanc request. */
export const REQUEST_TIMEOUT_MS = 30000;

/**
 * What a 404/405 means for a given route, when the body carries nothing
 * quotable. This has to be declared per call site rather than inferred from the
 * status: a route every healthy server exposes can only be missing because the
 * server is not the one we think it is, whereas a route that addresses one
 * specific resource 404s for entirely ordinary reasons.
 */
export type MissingRouteMeaning =
  /** The route is Orthanc's own; its absence means this origin is not Orthanc. */
  | 'not-orthanc'
  /** The route is added by the AI routing plugin; its absence means it is not enabled. */
  | 'plugin-missing';

/** Describes the call that failed, so the message can name it. */
export interface RequestContext {
  /** Infinitive describing the goal, e.g. 'look up the study in Orthanc'. */
  action: string;
  /** Method and path, e.g. 'POST /tools/lookup'. */
  route: string;
  /** Base URL the request was sent to. */
  baseUrl: string;
  /**
   * Omit for routes that legitimately 404 (a deleted workitem, an unknown id) —
   * those fall back to the plain status message instead of blaming the setup.
   */
  missingRouteMeans?: MissingRouteMeaning;
}

const MAX_DETAIL_CHARS = 200;

const CHECK_CONFIG =
  'Check that Orthanc is running and that "orthancUrl" in the viewer configuration points at it.';

/** `<` immediately followed by a tag-ish character, so "must be < 10" survives. */
const MARKUP = /<[a-z!/?]/i;

/** A `at fn (file:line:col)` frame — the giveaway for a leaked stack trace. */
const STACK_FRAME = /\bat\s+\S+\s*\(?\S+:\d+:\d+\)?/;

/**
 * Normalises a candidate detail, or returns null when it is not worth showing.
 *
 * Collapses whitespace, caps the length so one stray body cannot flood the
 * panel, and drops markup and stack traces: an HTML error page, or a message
 * that embeds one of either, is never useful to the reader.
 */
function toDetail(text: string): string | null {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  if (!oneLine || MARKUP.test(oneLine) || STACK_FRAME.test(oneLine)) {
    return null;
  }
  return oneLine.length > MAX_DETAIL_CHARS ? `${oneLine.slice(0, MAX_DETAIL_CHARS)}…` : oneLine;
}

/** "45 seconds" / "10 minutes" — never the "0 minutes" a bare round() gives. */
export function formatDuration(ms: number): string {
  const seconds = Math.max(1, Math.round(ms / 1000));
  if (seconds < 60) {
    return `${seconds} second${seconds === 1 ? '' : 's'}`;
  }
  const minutes = Math.round(seconds / 60);
  return `${minutes} minute${minutes === 1 ? '' : 's'}`;
}

/**
 * Pulls a quotable detail out of an error body, or null when there is none.
 *
 * Orthanc and the routing plugin report errors as JSON; proxies and dev servers
 * reply with HTML. Only the former is worth showing, so a body that is not JSON
 * — or is JSON without a recognised message field — yields null and the caller
 * falls back to a message built from the status alone.
 */
async function readErrorDetail(response: Response): Promise<string | null> {
  let bodyText: string;
  try {
    bodyText = await response.text();
  } catch {
    return null;
  }
  if (!bodyText.trim()) {
    return null;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(bodyText);
  } catch {
    // Not JSON. A short, markup-free body is still useful (some Orthanc plugins
    // reply in plain text); an HTML page never is.
    return toDetail(bodyText);
  }

  if (typeof parsed === 'string') {
    return toDetail(parsed);
  }
  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  // `message`/`error` are the routing plugin's shape; `Message`/`Details` are
  // Orthanc's own REST error shape. Each candidate goes through toDetail, so a
  // field holding an escaped HTML page is skipped in favour of the next one.
  const record = parsed as Record<string, unknown>;
  return (
    [record.message, record.error, record.Message, record.Details]
      .filter((value): value is string => typeof value === 'string')
      .map(toDetail)
      .find((value): value is string => value !== null) ?? null
  );
}

/** Message for a response that arrived but reported a failure. */
export async function describeHttpFailure(
  response: Response,
  ctx: RequestContext
): Promise<string> {
  const detail = await readErrorDetail(response);

  // A 404/405 with nothing quotable means the origin answered but has no such
  // route. Only routes the caller has flagged get the diagnosis — see
  // MissingRouteMeaning for why this cannot be inferred from the status alone.
  if (!detail && (response.status === 404 || response.status === 405) && ctx.missingRouteMeans) {
    return ctx.missingRouteMeans === 'not-orthanc'
      ? `No Orthanc API at ${ctx.baseUrl}: ${ctx.route} returned ${response.status}. ${CHECK_CONFIG}`
      : `The Orthanc server at ${ctx.baseUrl} has no ${ctx.route} route (HTTP ${response.status}). ` +
          'The AI routing plugin is probably not installed or not enabled.';
  }

  return detail
    ? `Failed to ${ctx.action} (HTTP ${response.status}): ${detail}`
    : `Failed to ${ctx.action} (HTTP ${response.status}).`;
}

/** Message for a request that never produced a usable response. */
export function describeRequestFailure(error: unknown, ctx: RequestContext): string {
  const name = error instanceof Error ? error.name : undefined;

  if (name === 'AbortError') {
    return `Request timed out after ${formatDuration(REQUEST_TIMEOUT_MS)} waiting for ${ctx.baseUrl}.`;
  }
  // fetch rejects with a TypeError when the request never reached a server at
  // all: connection refused, DNS failure, or blocked by CORS. The name is
  // checked as well as the prototype because a TypeError raised in another
  // realm (an iframe, a polyfilled fetch) fails `instanceof`.
  if (error instanceof TypeError || name === 'TypeError') {
    return `Cannot reach the Orthanc server at ${ctx.baseUrl}. ${CHECK_CONFIG}`;
  }
  // Anything else is one of our own thrown Errors, whose message is already
  // written for the reader; toDetail strips a message that is not.
  const detail = error instanceof Error ? toDetail(error.message) : null;
  return detail ?? `Failed to ${ctx.action}.`;
}

/**
 * Message for a 2xx response whose body is not the JSON the caller expected —
 * the signature of a proxy or SPA fallback serving an HTML page on success.
 */
export function describeUnexpectedBody(ctx: RequestContext): string {
  return `${ctx.baseUrl} answered ${ctx.route} with an unexpected body — it does not look like an Orthanc server. ${CHECK_CONFIG}`;
}
