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
    fetchMock.mockResolvedValueOnce(mockResponse({ json: [{ ID: 'x', Type: 'Series', Path: '' }] }));
    await expect(service.getOrthancStudyId('1.2.3')).rejects.toThrow('No Orthanc Study ID');
  });

  it('throws with the response body text on non-ok', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, status: 500, text: 'boom' }));
    await expect(service.getOrthancStudyId('1.2.3')).rejects.toThrow('Failed to lookup study: boom');
  });

  it('throws when the lookup response is an empty array', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ json: [] }));
    await expect(service.getOrthancStudyId('1.2.3')).rejects.toThrow('No Orthanc Study ID found');
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

  it('returns null and caches null on non-ok', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, status: 404 }));
    expect(await service.getModelManifest(EP)).toBeNull();
    expect(await service.getModelManifest(EP)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
      .mockResolvedValueOnce(mockResponse({ json: [{ ID: 'orthanc-99', Type: 'Study', Path: '' }] }))
      .mockResolvedValueOnce(mockResponse({ json: { status: 'success', workitem_uid: 'w1', message: 'ok' } }));

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
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 400, json: { message: 'bad input' } }));
    await expect(service.routeStudyToAI('1.2.3')).rejects.toThrow('bad input');
  });

  it('maps an AbortError to a timeout message', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ json: [{ ID: 'o1', Type: 'Study', Path: '' }] }));
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(service.routeStudyToAI('1.2.3')).rejects.toThrow('Request timed out after 30 seconds');
  });

  it('surfaces {error} from a non-ok send response', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse({ json: [{ ID: 'o1', Type: 'Study', Path: '' }] }))
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 422, json: { error: 'validation failed' } }));
    await expect(service.routeStudyToAI('1.2.3')).rejects.toThrow('validation failed');
  });

  // extractErrorMessage reads the body once as text and tries to JSON.parse it.
  // A non-JSON body (e.g. an HTML error page) is not surfaced raw — we prefer the
  // clean status-based message.
  it('falls back to the status-based message when the error body is not JSON', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse({ json: [{ ID: 'o1', Type: 'Study', Path: '' }] }))
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 502, text: '<html>Bad Gateway</html>' }));
    await expect(service.routeStudyToAI('1.2.3')).rejects.toThrow('HTTP error! status: 502');
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
    await expect(bare.routeSeriesToAI('1.2.3', ['s1'])).rejects.toThrow('No AI endpoint configured');
  });

  it('surfaces {message} from a non-ok send response', async () => {
    fetchMock
      .mockResolvedValueOnce(mockResponse({ json: [{ ID: 'o1', Type: 'Study', Path: '' }] }))
      .mockResolvedValueOnce(mockResponse({ ok: false, status: 400, json: { message: 'bad series' } }));
    await expect(service.routeSeriesToAI('1.2.3', ['s1'])).rejects.toThrow('bad series');
  });

  it('maps an AbortError to a timeout message', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ json: [{ ID: 'o1', Type: 'Study', Path: '' }] }));
    fetchMock.mockRejectedValueOnce(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    await expect(service.routeSeriesToAI('1.2.3', ['s1'])).rejects.toThrow('Request timed out after 30 seconds');
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
    expect(status).toMatchObject({ state: 'IN_PROGRESS', progress: 42, progressDescription: 'halfway' });
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
    await expect(service.getWorkitemStatus('w1')).rejects.toThrow('Failed to get workitem status: 404');
  });

  it('throws on an unparseable body', async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ text: 'not json' }));
    await expect(service.getWorkitemStatus('w1')).rejects.toThrow('Failed to parse workitem JSON');
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
