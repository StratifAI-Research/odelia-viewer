// Shared test harness for the orthanc-ai-routing extension.
// NOT a *.test.ts so it is not collected as a suite; excluded from coverage
// via collectCoverageFrom (!src/test-utils/**).

/** Minimal Response-like factory for fetch mocking. */
export function mockResponse(opts: {
  ok?: boolean;
  status?: number;
  json?: unknown;
  text?: string;
}): Response {
  const { ok = true, status = 200, json, text } = opts;
  return {
    ok,
    status,
    json: async () => {
      if (json === undefined) {
        throw new SyntaxError('mockResponse: no json body provided');
      }
      return json;
    },
    text: async () => (text !== undefined ? text : JSON.stringify(json ?? '')),
  } as unknown as Response;
}

/** Installs a jest.fn() as global.fetch and returns it. Call in beforeEach. */
export function installFetchMock(): jest.Mock {
  const fn = jest.fn();
  (global as unknown as { fetch: jest.Mock }).fetch = fn;
  return fn;
}

/** localStorage override matching the existing OrthancAIService.test.ts pattern. */
export function installLocalStorageMock(): void {
  let store: Record<string, string> = {};
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      getItem: (k: string) => (k in store ? store[k] : null),
      setItem: (k: string, v: string) => {
        store[k] = String(v);
      },
      removeItem: (k: string) => {
        delete store[k];
      },
      clear: () => {
        store = {};
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
