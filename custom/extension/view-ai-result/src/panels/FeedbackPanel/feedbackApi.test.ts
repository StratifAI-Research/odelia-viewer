import {
  deriveFeedbackApiBase,
  fetchFeedbackStatus,
  findUserVerdict,
  submitFeedback,
} from './feedbackApi';

const KEY = {
  studyUID: 'study-1',
  modelName: 'BreastNet',
  modelVersion: '1.2.0',
  resultTs: '2024-03-15T10:00:00Z',
};

describe('deriveFeedbackApiBase', () => {
  afterEach(() => delete (window as any).config);

  it('strips /dicom-web from a qidoRoot to get the Orthanc base', () => {
    (window as any).config = { dataSources: [{ configuration: { qidoRoot: '/pacs/dicom-web' } }] };
    expect(deriveFeedbackApiBase()).toBe('/pacs');
  });

  it('returns empty base when qidoRoot is exactly /dicom-web', () => {
    (window as any).config = { dataSources: [{ configuration: { qidoRoot: '/dicom-web' } }] };
    expect(deriveFeedbackApiBase()).toBe('');
  });

  it('falls back to same-origin root when config is missing', () => {
    expect(deriveFeedbackApiBase()).toBe('');
  });
});

describe('fetchFeedbackStatus', () => {
  afterEach(() => jest.restoreAllMocks());

  it('requests /feedback with the key params and the abort signal', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ users: [] }) });
    (global as any).fetch = fetchMock;
    const controller = new AbortController();

    await fetchFeedbackStatus(KEY, controller.signal);

    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/feedback?');
    expect(String(url)).toContain('study_uid=study-1');
    expect(String(url)).toContain('model_name=BreastNet');
    expect(String(url)).toContain('includeUsers=true');
    expect(opts.signal).toBe(controller.signal);
  });

  it('returns null on a non-OK response', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({ ok: false, json: async () => ({}) });
    expect(await fetchFeedbackStatus(KEY)).toBeNull();
  });
});

describe('findUserVerdict', () => {
  it('finds the matching user or returns null', () => {
    const status = { users: [{ user_id: 'a', verdict_L: 1, verdict_R: -1 }] };
    expect(findUserVerdict(status, 'a')?.verdict_L).toBe(1);
    expect(findUserVerdict(status, 'b')).toBeNull();
    expect(findUserVerdict(null, 'a')).toBeNull();
    expect(findUserVerdict({}, 'a')).toBeNull();
  });
});

describe('submitFeedback', () => {
  it('POSTs the payload as JSON to /feedback/submit', async () => {
    const fetchMock = jest.fn().mockResolvedValue({ status: 201, ok: true });
    (global as any).fetch = fetchMock;
    const payload = {
      study_uid: 'study-1',
      model_name: 'BreastNet',
      model_version: '1.2.0',
      result_ts: '2024-03-15T10:00:00Z',
      user_id: 'rad-7',
      verdict_L: 1,
      verdict_R: -1,
    };
    await submitFeedback(payload);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(String(url)).toContain('/feedback/submit');
    expect(opts.method).toBe('POST');
    expect(JSON.parse(opts.body)).toMatchObject(payload);
  });
});
