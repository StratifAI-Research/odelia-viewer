let client: typeof import('./releaseClient');
const release = {
  tag_name: 'v3.5.0',
  draft: false,
  prerelease: false,
  html_url: 'https://github.com/StratifAI-Research/odelia-viewer/releases/tag/v3.5.0',
};
const response = (status = 200, body: unknown = release, headers = {}) => ({
  ok: status === 200,
  status,
  json: async () => body,
  headers: { get: (key: string) => headers[key] || null },
});
beforeEach(() => {
  jest.resetModules();
  jest.useFakeTimers().setSystemTime(new Date('2026-09-15T12:00:00Z'));
  localStorage.clear();
  global.fetch = jest.fn().mockResolvedValue(response());
  client = require('./releaseClient');
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

test.each([
  ['v1.10.0', '1.9.0', true],
  ['v3.4.0', '3.4.0', false],
  ['v2.2.0', '3.4.0', false],
  ['v3.5.0', 'invalid', false],
])('compares %s against %s', (tag, installed, expected) => {
  expect(client.newer(client.parseRelease({ ...release, tag_name: tag }), installed)).toBe(
    expected
  );
});
test.each(['3.5.0-beta.1', '', 'garbage', '01.2.3'])('rejects unstable/invalid version %s', tag => {
  expect(client.stableVersion(tag)).toBeNull();
});
test.each([
  { draft: true },
  { prerelease: true },
  { html_url: 'javascript:alert(1)' },
  { html_url: 'https://github.com.evil.test/StratifAI-Research/odelia-viewer/releases/tag/v3.5.0' },
  { html_url: 'https://github.com/another/repo/releases/tag/v3.5.0' },
])('rejects invalid release %p', value => {
  expect(client.parseRelease({ ...release, ...value })).toBeNull();
});

test('deduplicates requests and caches validated results', async () => {
  const first = client.checkRelease(24 * client.HOUR);
  const second = client.checkRelease(24 * client.HOUR);
  expect(first).toBe(second);
  expect(await first).toEqual({ version: '3.5.0', url: release.html_url });
  await client.checkRelease(24 * client.HOUR);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch).toHaveBeenCalledWith(
    client.ENDPOINT,
    expect.objectContaining({
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: expect.anything(),
    })
  );
  jest.advanceTimersByTime(24 * client.HOUR);
  await client.checkRelease(24 * client.HOUR);
  expect(fetch).toHaveBeenCalledTimes(2);
});
test.each([404, 500, 403, 429])('silently cools down HTTP %s', async status => {
  (fetch as jest.Mock).mockResolvedValue(response(status));
  expect(await client.checkRelease(24 * client.HOUR)).toBeNull();
  await client.checkRelease(24 * client.HOUR);
  expect(fetch).toHaveBeenCalledTimes(1);
  jest.advanceTimersByTime(status === 404 ? 24 * client.HOUR : client.HOUR);
  await client.checkRelease(24 * client.HOUR);
  expect(fetch).toHaveBeenCalledTimes(2);
});
test('honors server retry delay', async () => {
  (fetch as jest.Mock).mockResolvedValue(response(429, null, { 'Retry-After': '7200' }));
  await client.checkRelease(24 * client.HOUR);
  jest.advanceTimersByTime(client.HOUR);
  await client.checkRelease(24 * client.HOUR);
  expect(fetch).toHaveBeenCalledTimes(1);
});
test('aborts a hung request and silently retries later', async () => {
  (fetch as jest.Mock).mockImplementation(
    (_url, options) =>
      new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')));
      })
  );
  const pending = client.checkRelease(24 * client.HOUR);
  await jest.advanceTimersByTimeAsync(8000);
  expect(await pending).toBeNull();
});
test.each(['{', JSON.stringify({ checkedAt: Date.now() + 1e12, nextAttemptAt: 1e15 })])(
  'recovers from malformed cache',
  async raw => {
    localStorage.setItem(client.CACHE_KEY, raw);
    expect(await client.checkRelease(24 * client.HOUR)).not.toBeNull();
  }
);
test('works when storage is denied', async () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('denied');
  });
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('denied');
  });
  expect(await client.checkRelease(24 * client.HOUR)).not.toBeNull();
  await client.checkRelease(24 * client.HOUR);
  expect(fetch).toHaveBeenCalledTimes(1);
});
test('does not present expired cached results after an unsuccessful refresh', async () => {
  await client.checkRelease(24 * client.HOUR);
  jest.advanceTimersByTime(24 * client.HOUR);
  (fetch as jest.Mock).mockRejectedValue(new Error('offline'));
  expect(await client.checkRelease(24 * client.HOUR)).toBeNull();
});
