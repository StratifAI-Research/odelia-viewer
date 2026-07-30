// Shared test harness for the orthanc-ai-routing extension.
// NOT a *.test.ts so it is not collected as a suite; excluded from coverage
// via collectCoverageFrom (!src/test-utils/**).

/**
 * Minimal Response-like factory for fetch mocking.
 *
 * Faithful to the real fetch Response body contract: the body stream can be
 * consumed ONCE. Calling json()/text() a second time (in either order) throws,
 * exactly as a browser does. This matters: code that calls response.json() and
 * then response.text() on the same Response (e.g. the error-extraction fallback
 * in OrthancAIService) only "works" against a lax mock — in a real browser the
 * second read throws because json() already consumed (and locked) the stream.
 */
export function mockResponse(opts: {
  ok?: boolean;
  status?: number;
  json?: unknown;
  text?: string;
}): Response {
  const { ok = true, status = 200, json, text } = opts;
  let consumed = false;
  const consume = () => {
    if (consumed) {
      throw new TypeError('Body has already been consumed.');
    }
    consumed = true;
  };
  return {
    ok,
    status,
    json: async () => {
      consume(); // a real Response reads (and locks) the stream before parsing
      if (json !== undefined) {
        return json;
      }
      // Parity with a real Response: json() parses the body text (throwing a
      // SyntaxError on invalid JSON) so tests can supply a body via `text`.
      if (text !== undefined) {
        return JSON.parse(text);
      }
      throw new SyntaxError('mockResponse: body is not valid JSON');
    },
    text: async () => {
      consume();
      return text !== undefined ? text : JSON.stringify(json ?? '');
    },
  } as unknown as Response;
}

/** Installs a jest.fn() as global.fetch and returns it. Call in beforeEach. */
export function installFetchMock(): jest.Mock {
  const fn = jest.fn();
  (global as unknown as { fetch: jest.Mock }).fetch = fn;
  return fn;
}

// Module-level backing store, deliberately decoupled from the property identity:
// jsdom's window.localStorage redefine via defineProperty can no-op after the
// first install, leaving a stale mock in place. By resetting this shared store on
// every install, data clears between tests even if the property object persists.
let __lsStore: Record<string, string> = {};

/** Installs a fresh, isolated localStorage mock. Call in beforeEach. */
export function installLocalStorageMock(): void {
  __lsStore = {};
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (k in __lsStore ? __lsStore[k] : null),
      setItem: (k: string, v: string) => {
        __lsStore[k] = String(v);
      },
      removeItem: (k: string) => {
        delete __lsStore[k];
      },
      clear: () => {
        __lsStore = {};
      },
    },
  });
}

/** Sets window.location search params via history (jsdom-safe). */
export function setStudyUIDsInURL(value: string | null): void {
  const qs = value === null ? '' : `?StudyInstanceUIDs=${encodeURIComponent(value)}`;
  window.history.replaceState({}, '', `/${qs}`);
}

export const AI_ENDPOINT = {
  id: 'ep-1',
  name: 'test-ai',
  url: 'http://test-ai:8042/dicom-web',
};

/** Silences the source's heavy console logging; restore via jest.restoreAllMocks(). */
export function silenceConsole(): void {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
}
