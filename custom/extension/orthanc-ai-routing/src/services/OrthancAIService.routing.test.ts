import {
  installFetchMock,
  installLocalStorageMock,
  mockResponse,
  setStudyUIDsInURL,
  silenceConsole,
  AI_ENDPOINT,
} from '../test-utils/harness';
import OrthancAIService from './OrthancAIService';

describe('OrthancAIService — endpoints & URL parsing', () => {
  let service: OrthancAIService;

  beforeEach(() => {
    installLocalStorageMock();
    installFetchMock();
    silenceConsole();
    service = new OrthancAIService({ configuration: { orthancUrl: 'http://orthanc:8042' } });
  });
  afterEach(() => jest.restoreAllMocks());

  it('adopts the first stored endpoint on construction', () => {
    localStorage.setItem('aiEndpoints', JSON.stringify([AI_ENDPOINT]));
    const s = new OrthancAIService({ configuration: {} });
    expect(s.getCurrentEndpoint()).toEqual(AI_ENDPOINT);
  });

  it('getAIEndpoints returns [] on malformed JSON without throwing', () => {
    localStorage.setItem('aiEndpoints', '{not valid');
    expect(service.getAIEndpoints()).toEqual([]);
  });

  it('setCurrentEndpoint writes the updated endpoint back into the stored array', () => {
    localStorage.setItem(
      'aiEndpoints',
      JSON.stringify([{ id: 'ep-1', name: 'old', url: 'http://old' }])
    );
    service.setCurrentEndpoint({ id: 'ep-1', name: 'new', url: 'http://new' });
    const stored = JSON.parse(localStorage.getItem('aiEndpoints') as string);
    expect(stored[0]).toEqual({ id: 'ep-1', name: 'new', url: 'http://new' });
    expect(service.getCurrentEndpoint()).toMatchObject({ name: 'new' });
  });

  it('getDicomStudyInstanceUIDFromURL returns the first UID', () => {
    setStudyUIDsInURL('1.2.3,4.5.6');
    expect(service.getDicomStudyInstanceUIDFromURL()).toBe('1.2.3');
  });

  it('getDicomStudyInstanceUIDFromURL returns null when param absent', () => {
    setStudyUIDsInURL(null);
    expect(service.getDicomStudyInstanceUIDFromURL()).toBeNull();
  });
});

describe('OrthancAIService — getOrthancStudyId', () => {
  let fetchMock: jest.Mock;
  let service: OrthancAIService;

  beforeEach(() => {
    installLocalStorageMock();
    fetchMock = installFetchMock();
    silenceConsole();
    service = new OrthancAIService({ configuration: { orthancUrl: 'http://orthanc:8042' } });
  });
  afterEach(() => jest.restoreAllMocks());

  it('POSTs the UID as text/plain and returns the Study-type ID', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        json: [
          { ID: 'series-1', Type: 'Series', Path: '' },
          { ID: 'orthanc-99', Type: 'Study', Path: '' },
        ],
      })
    );
    const id = await service.getOrthancStudyId('1.2.3');
    expect(id).toBe('orthanc-99');
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://orthanc:8042/tools/lookup');
    expect(init.method).toBe('POST');
    expect(init.headers['Content-Type']).toBe('text/plain');
    expect(init.body).toBe('1.2.3');
  });

  it('throws when no Study-type result is present', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ json: [{ ID: 'x', Type: 'Series', Path: '' }] })
    );
    await expect(service.getOrthancStudyId('1.2.3')).rejects.toThrow(
      'Orthanc has no study with StudyInstanceUID 1.2.3'
    );
  });

  it('throws with the response body text on non-ok', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, status: 500, text: 'boom' }));
    await expect(service.getOrthancStudyId('1.2.3')).rejects.toThrow(
      'Failed to look up the study in Orthanc (HTTP 500): boom'
    );
  });

  it('throws when the lookup response is an empty array', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ json: [] }));
    await expect(service.getOrthancStudyId('1.2.3')).rejects.toThrow('Orthanc has no study');
  });

  // The reported bug: with no Orthanc attached the viewer's own dev server
  // answers the lookup with an HTML 404 page, and the whole page — doctype,
  // <head>, <pre>Cannot POST /tools/lookup</pre> — was pasted into the panel.
  it('reports a misconfigured server instead of echoing an HTML 404 page', async () => {
    const html =
      '<!DOCTYPE html><html lang="en"><head><meta charset="utf-8">' +
      '<title>Error</title></head><body><pre>Cannot POST /tools/lookup</pre></body></html>';
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, status: 404, text: html }));

    const error = await service.getOrthancStudyId('1.2.3').catch((e: Error) => e);
    expect(error).toBeInstanceOf(Error);
    // Negative control: none of the markup survives into the message.
    expect((error as Error).message).not.toMatch(/[<>]/);
    expect((error as Error).message).toBe(
      'No Orthanc API at http://orthanc:8042: POST /tools/lookup returned 404. ' +
        'Check that Orthanc is running and that "orthancUrl" in the viewer configuration points at it.'
    );
  });

  // A genuine Orthanc 404 carries a JSON body; that detail is worth quoting, so
  // the "not an Orthanc server" wording must not swallow it.
  it('quotes an Orthanc JSON error body on a 404 rather than blaming the configuration', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ ok: false, status: 404, json: { Message: 'Unknown resource' } })
    );
    await expect(service.getOrthancStudyId('1.2.3')).rejects.toThrow(
      'Failed to look up the study in Orthanc (HTTP 404): Unknown resource'
    );
  });

  it('reports an unreachable server when fetch rejects with a TypeError', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(service.getOrthancStudyId('1.2.3')).rejects.toThrow(
      'Cannot reach the Orthanc server at http://orthanc:8042.'
    );
  });

  it('reports a non-Orthanc server when a 200 body is not the expected JSON array', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ text: '<html>index</html>' }));
    await expect(service.getOrthancStudyId('1.2.3')).rejects.toThrow('does not look like an Orthanc server');
  });

  it('reports a non-Orthanc server when a 200 body is JSON but not an array', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ json: { unexpected: true } }));
    await expect(service.getOrthancStudyId('1.2.3')).rejects.toThrow('does not look like an Orthanc server');
  });

  // A proxy can wrap an HTML page inside a JSON error field. The markup filter
  // must apply to JSON-derived details too, not just to non-JSON bodies.
  it('skips a JSON error field that contains markup and falls through to the next', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({
        ok: false,
        status: 500,
        json: { message: '<html>proxy failure</html>', error: 'upstream refused' },
      })
    );
    const error = await service.getOrthancStudyId('1.2.3').catch((e: Error) => e);
    expect((error as Error).message).toBe(
      'Failed to look up the study in Orthanc (HTTP 500): upstream refused'
    );
    expect((error as Error).message).not.toMatch(/[<>]/);
  });

  it('falls back to the status message when every JSON error field is markup', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ ok: false, status: 500, json: { message: '<html>nope</html>' } })
    );
    const error = await service.getOrthancStudyId('1.2.3').catch((e: Error) => e);
    expect((error as Error).message).toBe('Failed to look up the study in Orthanc (HTTP 500).');
  });

  // A cross-realm TypeError (iframe, polyfilled fetch) fails `instanceof`, so
  // the name is checked too — otherwise the reader gets a bare "Failed to fetch".
  it('recognises a cross-realm TypeError by name', async () => {
    const crossRealm = new Error('Failed to fetch');
    crossRealm.name = 'TypeError';
    fetchMock.mockRejectedValueOnce(crossRealm);
    await expect(service.getOrthancStudyId('1.2.3')).rejects.toThrow(
      'Cannot reach the Orthanc server at http://orthanc:8042.'
    );
  });

  it('caps an over-long error detail so one body cannot flood the panel', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ ok: false, status: 500, json: { message: 'x'.repeat(500) } })
    );
    const error = await service.getOrthancStudyId('1.2.3').catch((e: Error) => e);
    expect((error as Error).message.length).toBeLessThan(300);
    expect((error as Error).message).toMatch(/…$/);
  });
});

describe('OrthancAIService — getModelManifest (+ cache)', () => {
  let fetchMock: jest.Mock;
  let service: OrthancAIService;
  const EP = 'http://ai:8042/dicom-web';

  beforeEach(() => {
    installLocalStorageMock();
    fetchMock = installFetchMock();
    silenceConsole();
    service = new OrthancAIService({ configuration: { orthancUrl: 'http://orthanc:8042' } });
  });
  afterEach(() => jest.restoreAllMocks());

  it('returns data.manifest when present and caches it (no second fetch)', async () => {
    const manifest = { model_id: 'm', model_name: 'M', version: '1', input_configurations: [] };
    fetchMock.mockResolvedValueOnce(mockResponse({ json: { manifest } }));
    expect(await service.getModelManifest(EP)).toEqual(manifest);
    expect(await service.getModelManifest(EP)).toEqual(manifest);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('treats a top-level object with model_id as the manifest', async () => {
    const data = { model_id: 'm', model_name: 'M', version: '1', input_configurations: [] };
    fetchMock.mockResolvedValueOnce(mockResponse({ json: data }));
    expect(await service.getModelManifest(EP)).toEqual(data);
  });

  it('returns null on non-ok WITHOUT caching, so a later call retries (OAR-M-manifest)', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, status: 404 }));
    expect(await service.getModelManifest(EP)).toBeNull();
    // A transient failure must not be cached: the next call re-fetches and can
    // recover the real manifest (previously null was frozen until reload).
    const manifest = { model_id: 'm', model_name: 'M', version: '1', input_configurations: [] };
    fetchMock.mockResolvedValueOnce(mockResponse({ json: { manifest } }));
    expect(await service.getModelManifest(EP)).toEqual(manifest);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null when fetch throws', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network'));
    expect(await service.getModelManifest(EP)).toBeNull();
  });

  it('clearManifestCache forces a refetch', async () => {
    fetchMock.mockResolvedValue(mockResponse({ json: { manifest: null } }));
    await service.getModelManifest(EP);
    service.clearManifestCache();
    await service.getModelManifest(EP);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('returns null when manifest key is absent and there is no model_id', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ json: { some_other_key: true } }));
    expect(await service.getModelManifest(EP)).toBeNull();
  });
});

describe('OrthancAIService — routeStudyToAI', () => {
  let fetchMock: jest.Mock;
  let service: OrthancAIService;

  beforeEach(() => {
    installLocalStorageMock();
    fetchMock = installFetchMock();
    silenceConsole();
    service = new OrthancAIService({ configuration: { orthancUrl: 'http://orthanc:8042' } });
    service.setCurrentEndpoint(AI_ENDPOINT);
  });
  afterEach(() => jest.restoreAllMocks());

  it('looks up the study id then POSTs to /send-to-ai', async () => {
    fetchMock
      .mockResolvedValueOnce(
        mockResponse({ json: [{ ID: 'orthanc-99', Type: 'Study', Path: '' }] })
      )
      .mockResolvedValueOnce(
        mockResponse({ json: { status: 'success', workitem_uid: 'w1', message: 'ok' } })
      );

    const res = await service.routeStudyToAI('1.2.3');
    expect(res).toEqual({ status: 'success', workitem_uid: 'w1', message: 'ok' });

    const [sendUrl, sendInit] = fetchMock.mock.calls[1];
    expect(sendUrl).toBe('http://orthanc:8042/send-to-ai');
    expect(JSON.parse(sendInit.body)).toEqual({
      study_id: 'orthanc-99',
      target: 'test-ai',
      target_url: AI_ENDPOINT.url,
    });
  });

  it('throws when no endpoint is configured', async () => {
    // Explicit precondition: empty endpoints array → loadCurrentEndpoint leaves it null.
    localStorage.setItem('aiEndpoints', JSON.stringify([]));
    const bare = new OrthancAIService({ configuration: {} });
    expect(bare.getCurrentEndpoint()).toBeNull();
    await expect(bare.routeStudyToAI('1.2.3')).rejects.toThrow('No AI endpoint configured');
  });

  it('surfaces {message} from a non-ok send response', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse({ json: [{ ID: 'o1', Type: 'Study', Path: '' }] }))
      .mockResolvedValueOnce(
        mockResponse({ ok: false, status: 400, json: { message: 'bad input' } })
      );
    await expect(service.routeStudyToAI('1.2.3')).rejects.toThrow('bad input');
  });

  it('maps an AbortError to a timeout message', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ json: [{ ID: 'o1', Type: 'Study', Path: '' }] })
    );
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(service.routeStudyToAI('1.2.3')).rejects.toThrow(
      'Request timed out after 30 seconds'
    );
  });

  // /send-to-ai is the routing plugin's route, not Orthanc's. A 404 there means
  // the plugin is missing — telling the reader to check `orthancUrl` (which the
  // successful lookup just proved correct) would send them the wrong way.
  it('blames the routing plugin, not the configuration, for a 404 on /send-to-ai', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse({ json: [{ ID: 'o1', Type: 'Study', Path: '' }] }))
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 404, text: '<html>404</html>' }));
    const error = await service.routeStudyToAI('1.2.3').catch((e: Error) => e);
    expect((error as Error).message).toBe(
      'The Orthanc server at http://orthanc:8042 has no POST /send-to-ai route (HTTP 404). ' +
        'The AI routing plugin is probably not installed or not enabled.'
    );
    expect((error as Error).message).not.toMatch(/orthancUrl/);
  });

  it('surfaces {error} from a non-ok send response', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse({ json: [{ ID: 'o1', Type: 'Study', Path: '' }] }))
      .mockResolvedValueOnce(
        mockResponse({ ok: false, status: 422, json: { error: 'validation failed' } })
      );
    await expect(service.routeStudyToAI('1.2.3')).rejects.toThrow('validation failed');
  });

  // The error body is read once as text and JSON.parse is attempted. A non-JSON
  // body (e.g. an HTML error page) is never surfaced raw — the status-based
  // message is used instead.
  it('falls back to the status-based message when the error body is not JSON', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse({ json: [{ ID: 'o1', Type: 'Study', Path: '' }] }))
      .mockResolvedValueOnce(
        mockResponse({ ok: false, status: 502, text: '<html>Bad Gateway</html>' })
      );
    const error = await service.routeStudyToAI('1.2.3').catch((e: Error) => e);
    expect((error as Error).message).toBe(
      'Failed to send the study to the AI endpoint (HTTP 502).'
    );
    expect((error as Error).message).not.toMatch(/[<>]/);
  });
});

describe('OrthancAIService — routeSeriesToAI', () => {
  let fetchMock: jest.Mock;
  let service: OrthancAIService;

  beforeEach(() => {
    installLocalStorageMock();
    fetchMock = installFetchMock();
    silenceConsole();
    service = new OrthancAIService({ configuration: { orthancUrl: 'http://orthanc:8042' } });
    service.setCurrentEndpoint(AI_ENDPOINT);
  });
  afterEach(() => jest.restoreAllMocks());

  it('throws on empty series selection', async () => {
    await expect(service.routeSeriesToAI('1.2.3', [])).rejects.toThrow('No series selected');
  });

  it('includes series_uids and optional mapping fields when provided', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse({ json: [{ ID: 'o1', Type: 'Study', Path: '' }] }))
      .mockResolvedValueOnce(mockResponse({ json: { status: 'success', message: 'ok' } }));

    await service.routeSeriesToAI('1.2.3', ['s1', 's2'], { t1: 's1' }, 'cfg-1');
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body).toMatchObject({
      study_id: 'o1',
      series_uids: ['s1', 's2'],
      input_mapping: { t1: 's1' },
      input_configuration_id: 'cfg-1',
    });
  });

  it('omits mapping fields when not provided', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse({ json: [{ ID: 'o1', Type: 'Study', Path: '' }] }))
      .mockResolvedValueOnce(mockResponse({ json: { status: 'success', message: 'ok' } }));

    await service.routeSeriesToAI('1.2.3', ['s1']);
    const body = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(body.input_mapping).toBeUndefined();
    expect(body.input_configuration_id).toBeUndefined();
  });

  it('throws when no endpoint is configured', async () => {
    localStorage.setItem('aiEndpoints', JSON.stringify([]));
    const bare = new OrthancAIService({ configuration: {} });
    await expect(bare.routeSeriesToAI('1.2.3', ['s1'])).rejects.toThrow(
      'No AI endpoint configured'
    );
  });

  it('surfaces {message} from a non-ok send response', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse({ json: [{ ID: 'o1', Type: 'Study', Path: '' }] }))
      .mockResolvedValueOnce(
        mockResponse({ ok: false, status: 400, json: { message: 'bad series' } })
      );
    await expect(service.routeSeriesToAI('1.2.3', ['s1'])).rejects.toThrow('bad series');
  });

  it('maps an AbortError to a timeout message', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ json: [{ ID: 'o1', Type: 'Study', Path: '' }] })
    );
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(service.routeSeriesToAI('1.2.3', ['s1'])).rejects.toThrow(
      'Request timed out after 30 seconds'
    );
  });
});

describe('OrthancAIService — getWorkitemStatus / parseWorkitemStatus', () => {
  let fetchMock: jest.Mock;
  let service: OrthancAIService;

  beforeEach(() => {
    installLocalStorageMock();
    fetchMock = installFetchMock();
    silenceConsole();
    service = new OrthancAIService({ configuration: { orthancUrl: 'http://orthanc:8042' } });
  });
  afterEach(() => jest.restoreAllMocks());

  it('maps ProcedureStepState to state', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ text: JSON.stringify({ '00741000': { vr: 'CS', Value: ['COMPLETED'] } }) })
    );
    expect(await service.getWorkitemStatus('w1')).toMatchObject({ state: 'COMPLETED' });
  });

  it('extracts progress and description from the progress sequence', async () => {
    const body = {
      '00741000': { vr: 'CS', Value: ['IN_PROGRESS'] },
      '00741002': {
        vr: 'SQ',
        Value: [
          {
            '00741004': { vr: 'DS', Value: ['42'] },
            '00741006': { vr: 'ST', Value: ['halfway'] },
          },
        ],
      },
    };
    fetchMock.mockResolvedValueOnce(mockResponse({ text: JSON.stringify(body) }));
    const status = await service.getWorkitemStatus('w1');
    expect(status).toMatchObject({
      state: 'IN_PROGRESS',
      progress: 42,
      progressDescription: 'halfway',
    });
  });

  it('extracts the cancellation reason', async () => {
    const body = {
      '00741000': { vr: 'CS', Value: ['CANCELED'] },
      '00741238': { vr: 'LO', Value: ['user aborted'] },
    };
    fetchMock.mockResolvedValueOnce(mockResponse({ text: JSON.stringify(body) }));
    expect(await service.getWorkitemStatus('w1')).toMatchObject({
      state: 'CANCELED',
      cancellationReason: 'user aborted',
    });
  });

  it('throws on non-ok', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, status: 404, text: 'missing' }));
    await expect(service.getWorkitemStatus('w1')).rejects.toThrow(
      'Failed to read the AI job status (HTTP 404): missing'
    );
  });

  // The raw SyntaxError embeds an excerpt of the body, and this message now
  // reaches the panel through the lost-contact path, so it must not appear.
  it('throws a sanitised message on an unparseable body', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ text: '<!DOCTYPE html><body>nope</body>' }));
    const error = await service.getWorkitemStatus('w1').catch((e: Error) => e);
    expect((error as Error).message).toBe(
      'http://orthanc:8042 answered GET /ups-rs/workitems with an unexpected body — ' +
        'it does not look like an Orthanc server. Check that Orthanc is running and that ' +
        '"orthancUrl" in the viewer configuration points at it.'
    );
    expect((error as Error).message).not.toMatch(/DOCTYPE|SyntaxError/);
  });

  // A real UPS-RS server returns 404 for a deleted or unknown workitem. That is
  // not a configuration fault, so it must not be reported as one.
  it('does not blame the configuration for a 404 on a specific workitem', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, status: 404, text: '' }));
    const error = await service.getWorkitemStatus('w1').catch((e: Error) => e);
    expect((error as Error).message).toBe('Failed to read the AI job status (HTTP 404).');
    expect((error as Error).message).not.toMatch(/orthancUrl/);
  });

  it('returns UNKNOWN state when the state tag is absent', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ text: JSON.stringify({}) }));
    expect(await service.getWorkitemStatus('w1')).toMatchObject({ state: 'UNKNOWN' });
  });

  it('returns UNKNOWN state when the state Value array is empty', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ text: JSON.stringify({ '00741000': { vr: 'CS', Value: [] } }) })
    );
    expect(await service.getWorkitemStatus('w1')).toMatchObject({ state: 'UNKNOWN' });
  });
});

describe('OrthancAIService — workitem polling', () => {
  let fetchMock: jest.Mock;
  let service: OrthancAIService;

  beforeEach(() => {
    jest.useFakeTimers();
    installLocalStorageMock();
    fetchMock = installFetchMock();
    silenceConsole();
    service = new OrthancAIService({ configuration: { orthancUrl: 'http://orthanc:8042' } });
  });
  afterEach(() => {
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  it('polls, invokes the callback, and stops on COMPLETED', async () => {
    // First tick is terminal (COMPLETED); a later tick, if it ever ran, would be
    // IN_PROGRESS — so consuming it would prove the loop failed to auto-stop.
    fetchMock
      .mockResolvedValueOnce(
        mockResponse({ text: JSON.stringify({ '00741000': { vr: 'CS', Value: ['COMPLETED'] } }) })
      )
      .mockResolvedValue(
        mockResponse({ text: JSON.stringify({ '00741000': { vr: 'CS', Value: ['IN_PROGRESS'] } }) })
      );
    const cb = jest.fn();
    await service.startWorkitemPolling('w1', cb, 500);

    expect(cb).not.toHaveBeenCalled(); // nothing fires before the first interval elapses
    await jest.advanceTimersByTimeAsync(500);
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb).toHaveBeenCalledWith(expect.objectContaining({ state: 'COMPLETED' }));

    await jest.advanceTimersByTimeAsync(2000);
    expect(cb).toHaveBeenCalledTimes(1); // auto-stopped: the IN_PROGRESS tick never runs
  });

  it('stopWorkitemPolling halts further callbacks for a non-terminal state', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ text: JSON.stringify({ '00741000': { vr: 'CS', Value: ['IN_PROGRESS'] } }) })
    );
    const cb = jest.fn();
    await service.startWorkitemPolling('w1', cb, 500);

    await jest.advanceTimersByTimeAsync(500);
    expect(cb).toHaveBeenCalledTimes(1);

    service.stopWorkitemPolling();
    await jest.advanceTimersByTimeAsync(2000);
    expect(cb).toHaveBeenCalledTimes(1); // no further ticks
  });

  it('keeps polling after a transient getWorkitemStatus failure', async () => {
    fetchMock
      .mockRejectedValueOnce(new Error('network error')) // first tick fails
      .mockResolvedValue(
        mockResponse({ text: JSON.stringify({ '00741000': { vr: 'CS', Value: ['IN_PROGRESS'] } }) })
      );
    const cb = jest.fn();
    await service.startWorkitemPolling('w1', cb, 500);

    await jest.advanceTimersByTimeAsync(500); // error swallowed, no callback
    expect(cb).not.toHaveBeenCalled();
    await jest.advanceTimersByTimeAsync(500); // recovers
    expect(cb).toHaveBeenCalledTimes(1);
    service.stopWorkitemPolling();
  });

  // The server going away mid-job used to be invisible: every poll failed
  // silently and the reader watched a progress bar until the 10-minute cap.
  it('gives up and reports lost contact after a run of consecutive failures', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    const cb = jest.fn();
    await service.startWorkitemPolling('w1', cb, 500);

    // Four failures in a row is still treated as transient.
    await jest.advanceTimersByTimeAsync(500 * 4);
    expect(cb).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(500); // fifth
    expect(cb).toHaveBeenCalledTimes(1);
    const status = cb.mock.calls[0][0];
    expect(status.state).toBe('CANCELED');
    expect(status.cancellationReason).toMatch(/Lost contact with the server/);
    expect(status.cancellationReason).toMatch(/Cannot reach the Orthanc server/);

    // The interval is cleared, so nothing fires afterwards.
    await jest.advanceTimersByTimeAsync(5000);
    expect(cb).toHaveBeenCalledTimes(1);
  });

  // Negative control for the counter: failures separated by a success must not
  // accumulate into a spurious give-up.
  it('resets the failure run after a successful poll', async () => {
    const inProgress = () =>
      mockResponse({ text: JSON.stringify({ '00741000': { vr: 'CS', Value: ['IN_PROGRESS'] } }) });
    fetchMock
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockImplementationOnce(async () => inProgress()) // success resets the run
      .mockRejectedValue(new TypeError('Failed to fetch'));
    const cb = jest.fn();
    await service.startWorkitemPolling('w1', cb, 500);

    await jest.advanceTimersByTimeAsync(500 * 8); // 4 fail, 1 ok, 3 fail
    expect(cb).toHaveBeenCalledTimes(1);
    expect(cb.mock.calls[0][0]).toMatchObject({ state: 'IN_PROGRESS' });
    service.stopWorkitemPolling();
  });

  it('stops polling and reports a timeout after the max duration', async () => {
    // Never terminal: always IN_PROGRESS.
    fetchMock.mockResolvedValue(
      mockResponse({ text: JSON.stringify({ '00741000': { vr: 'CS', Value: ['IN_PROGRESS'] } }) })
    );
    const cb = jest.fn();
    // interval 500ms, cap 1000ms => maxAttempts = 2.
    await service.startWorkitemPolling('w1', cb, 500, 1000);

    await jest.advanceTimersByTimeAsync(500); // attempt 1: IN_PROGRESS
    await jest.advanceTimersByTimeAsync(500); // attempt 2: IN_PROGRESS, then hits the cap

    const lastCall = cb.mock.calls[cb.mock.calls.length - 1][0];
    expect(lastCall).toMatchObject({ state: 'CANCELED' });
    // Asserted exactly: a loose /\d+ minutes?/ here passed while the message
    // actually read "0 minutes", because the duration was rounded from 1000ms.
    expect(lastCall.cancellationReason).toBe(
      'AI analysis timed out after 1 second without a result. ' +
        'The job may still be running on the server.'
    );

    // No further ticks run after the timeout stops the interval.
    const callsAfterTimeout = cb.mock.calls.length;
    await jest.advanceTimersByTimeAsync(2000);
    expect(cb.mock.calls.length).toBe(callsAfterTimeout);
  });

  // clearInterval only cancels future ticks. A poll already awaiting a response
  // used to complete and report into a run the caller had stopped — at a 2s
  // interval with a 30s timeout, up to ~15 of them.
  it('drops a poll that was still in flight when polling stopped', async () => {
    let release: (value: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>(resolve => {
          release = resolve;
        })
    );
    const cb = jest.fn();
    service.startWorkitemPolling('w1', cb, 500);

    await jest.advanceTimersByTimeAsync(500); // tick fires and blocks on fetch
    expect(cb).not.toHaveBeenCalled();

    service.stopWorkitemPolling();
    release(
      mockResponse({ text: JSON.stringify({ '00741000': { vr: 'CS', Value: ['COMPLETED'] } }) })
    );
    await jest.advanceTimersByTimeAsync(10);

    expect(cb).not.toHaveBeenCalled();
  });

  // Same hazard across runs: a straggler from workitem A must not report into
  // the callback now watching workitem B.
  it('drops an in-flight poll from a run that has been replaced', async () => {
    let releaseA: (value: Response) => void = () => {};
    fetchMock.mockImplementationOnce(
      () =>
        new Promise<Response>(resolve => {
          releaseA = resolve;
        })
    );
    const cbA = jest.fn();
    const cbB = jest.fn();
    service.startWorkitemPolling('wA', cbA, 500);
    await jest.advanceTimersByTimeAsync(500); // A's tick blocks on fetch

    fetchMock.mockResolvedValue(
      mockResponse({ text: JSON.stringify({ '00741000': { vr: 'CS', Value: ['IN_PROGRESS'] } }) })
    );
    service.startWorkitemPolling('wB', cbB, 500);

    releaseA(
      mockResponse({ text: JSON.stringify({ '00741000': { vr: 'CS', Value: ['COMPLETED'] } }) })
    );
    await jest.advanceTimersByTimeAsync(500);

    expect(cbA).not.toHaveBeenCalled();
    expect(cbB).toHaveBeenCalledTimes(1);
    expect(cbB.mock.calls[0][0]).toMatchObject({ state: 'IN_PROGRESS' });
    service.stopWorkitemPolling();
  });

  // setInterval fires on schedule regardless of whether the previous request
  // came back. At the panel's 2s interval against a server that can take the
  // full 30s request timeout, ticks used to pile ~15 requests deep — and the
  // overlapping replies scrambled the attempt count and the failure counter.
  it('runs one request at a time instead of piling up overlapping polls', async () => {
    let release: (value: Response) => void = () => {};
    fetchMock.mockImplementation(
      () =>
        new Promise<Response>(resolve => {
          release = resolve;
        })
    );
    const cb = jest.fn();
    service.startWorkitemPolling('w1', cb, 500, 60000);

    await jest.advanceTimersByTimeAsync(500 * 5); // five ticks, first still pending
    expect(fetchMock).toHaveBeenCalledTimes(1);

    release(
      mockResponse({ text: JSON.stringify({ '00741000': { vr: 'CS', Value: ['IN_PROGRESS'] } }) })
    );
    await jest.advanceTimersByTimeAsync(500); // slot free again, next tick polls
    expect(fetchMock).toHaveBeenCalledTimes(2);
    service.stopWorkitemPolling();
  });

  // The terminal-state handler stops polling *after* invoking the callback. If
  // that callback kicked off a new job, the stop would have killed the run it
  // had just started.
  it('does not stop a run that the terminal-state callback itself started', async () => {
    fetchMock.mockResolvedValueOnce(
      mockResponse({ text: JSON.stringify({ '00741000': { vr: 'CS', Value: ['COMPLETED'] } }) })
    );
    fetchMock.mockResolvedValue(
      mockResponse({ text: JSON.stringify({ '00741000': { vr: 'CS', Value: ['IN_PROGRESS'] } }) })
    );

    const cbB = jest.fn();
    const cbA = jest.fn(() => {
      service.startWorkitemPolling('wB', cbB, 500);
    });
    service.startWorkitemPolling('wA', cbA, 500);

    await jest.advanceTimersByTimeAsync(500); // A completes, its callback starts B
    expect(cbA).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(500); // B's first tick must still fire
    expect(cbB).toHaveBeenCalledTimes(1);
    expect(cbB.mock.calls[0][0]).toMatchObject({ state: 'IN_PROGRESS' });
    service.stopWorkitemPolling();
  });

  it('a second startWorkitemPolling call cancels the first interval', async () => {
    fetchMock.mockResolvedValue(
      mockResponse({ text: JSON.stringify({ '00741000': { vr: 'CS', Value: ['IN_PROGRESS'] } }) })
    );
    const cb1 = jest.fn();
    const cb2 = jest.fn();
    await service.startWorkitemPolling('w1', cb1, 500);
    await service.startWorkitemPolling('w2', cb2, 500);

    await jest.advanceTimersByTimeAsync(500);
    expect(cb1).not.toHaveBeenCalled(); // first interval was cleared
    expect(cb2).toHaveBeenCalledTimes(1);
    service.stopWorkitemPolling();
  });
});
