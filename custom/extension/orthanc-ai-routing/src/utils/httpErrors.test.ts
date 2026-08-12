import {
  describeHttpFailure,
  describeRequestFailure,
  describeUnexpectedBody,
  formatDuration,
  type RequestContext,
} from './httpErrors';
import { mockResponse } from '../test-utils/harness';

const LOOKUP: RequestContext = {
  action: 'look up the study in Orthanc',
  route: 'POST /tools/lookup',
  baseUrl: 'http://orthanc:8042',
  missingRouteMeans: 'not-orthanc',
};

const WORKITEM: RequestContext = {
  action: 'read the AI job status',
  route: 'GET /ups-rs/workitems',
  baseUrl: 'http://orthanc:8042',
};

describe('formatDuration', () => {
  // A bare Math.round(ms / 60000) reported "0 minutes" for anything under 30s.
  it.each([
    [0, '1 second'],
    [1000, '1 second'],
    [45000, '45 seconds'],
    [59000, '59 seconds'],
    [60000, '1 minute'],
    [600000, '10 minutes'],
  ])('formats %ims as "%s"', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe('describeHttpFailure', () => {
  it('quotes a JSON {message}', async () => {
    const response = mockResponse({ ok: false, status: 400, json: { message: 'bad input' } });
    expect(await describeHttpFailure(response, LOOKUP)).toBe(
      'Failed to look up the study in Orthanc (HTTP 400): bad input'
    );
  });

  it('quotes a short plain-text body', async () => {
    const response = mockResponse({ ok: false, status: 500, text: 'internal failure' });
    expect(await describeHttpFailure(response, LOOKUP)).toBe(
      'Failed to look up the study in Orthanc (HTTP 500): internal failure'
    );
  });

  it('falls back to the status alone for an empty body', async () => {
    const response = mockResponse({ ok: false, status: 500, text: '' });
    expect(await describeHttpFailure(response, LOOKUP)).toBe(
      'Failed to look up the study in Orthanc (HTTP 500).'
    );
  });

  it('diagnoses a missing Orthanc route as a wrong origin', async () => {
    const response = mockResponse({ ok: false, status: 404, text: '<html>404</html>' });
    expect(await describeHttpFailure(response, LOOKUP)).toMatch(/^No Orthanc API at/);
  });

  it('diagnoses a missing plugin route as a missing plugin', async () => {
    const response = mockResponse({ ok: false, status: 404, text: '' });
    expect(
      await describeHttpFailure(response, { ...LOOKUP, missingRouteMeans: 'plugin-missing' })
    ).toBe(
      'The Orthanc server at http://orthanc:8042 has no POST /tools/lookup route (HTTP 404). ' +
        'The AI routing plugin is probably not installed or not enabled.'
    );
  });

  // A resource-scoped route legitimately 404s, so it declares no meaning and
  // must not be reported as a broken configuration.
  it('leaves an undeclared route to the plain status message on 404', async () => {
    const response = mockResponse({ ok: false, status: 404, text: '' });
    expect(await describeHttpFailure(response, WORKITEM)).toBe(
      'Failed to read the AI job status (HTTP 404).'
    );
  });

  describe('detail filtering', () => {
    it.each([
      ['an HTML page', '<!DOCTYPE html><body><pre>Cannot POST /x</pre></body>'],
      ['a bare tag', '<html>'],
      ['a closing tag', '</pre>'],
      ['an XML declaration', '<?xml version="1.0"?>'],
    ])('drops %s', async (_label, body) => {
      const response = mockResponse({ ok: false, status: 500, text: body });
      const message = await describeHttpFailure(response, LOOKUP);
      expect(message).toBe('Failed to look up the study in Orthanc (HTTP 500).');
      expect(message).not.toMatch(/[<>]/);
    });

    it('drops a JSON field carrying a stack trace', async () => {
      const response = mockResponse({
        ok: false,
        status: 500,
        json: { message: 'Error: backend failed\n    at handler (/app/server.js:10:2)' },
      });
      const message = await describeHttpFailure(response, LOOKUP);
      expect(message).toBe('Failed to look up the study in Orthanc (HTTP 500).');
      expect(message).not.toMatch(/server\.js/);
    });

    // The markup test must not be a blanket ban on '<': comparisons are common
    // in validation messages and are exactly what the reader needs to see.
    it('keeps a message containing a less-than comparison', async () => {
      const response = mockResponse({
        ok: false,
        status: 422,
        json: { message: 'Series count must be < 10' },
      });
      expect(await describeHttpFailure(response, LOOKUP)).toBe(
        'Failed to look up the study in Orthanc (HTTP 422): Series count must be < 10'
      );
    });

    it('skips a markup field in favour of the next usable one', async () => {
      const response = mockResponse({
        ok: false,
        status: 500,
        json: { message: '<html>proxy</html>', error: 'upstream refused' },
      });
      expect(await describeHttpFailure(response, LOOKUP)).toMatch(/upstream refused$/);
    });

    it('collapses newlines and caps the length', async () => {
      const response = mockResponse({
        ok: false,
        status: 500,
        json: { message: `line one\nline two ${'x'.repeat(400)}` },
      });
      const message = await describeHttpFailure(response, LOOKUP);
      expect(message).not.toMatch(/\n/);
      expect(message.length).toBeLessThan(300);
      expect(message.endsWith('…')).toBe(true);
    });
  });
});

describe('describeRequestFailure', () => {
  it('maps an AbortError to a timeout naming the server', () => {
    const error = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(describeRequestFailure(error, LOOKUP)).toBe(
      'Request timed out after 30 seconds waiting for http://orthanc:8042.'
    );
  });

  it('maps a TypeError to an unreachable-server message', () => {
    expect(describeRequestFailure(new TypeError('Failed to fetch'), LOOKUP)).toMatch(
      /^Cannot reach the Orthanc server at http:\/\/orthanc:8042\./
    );
  });

  // A TypeError raised in another realm (iframe, polyfilled fetch) fails
  // `instanceof`, so the name is checked as well.
  it('recognises a cross-realm TypeError by name', () => {
    const error = new Error('Failed to fetch');
    error.name = 'TypeError';
    expect(describeRequestFailure(error, LOOKUP)).toMatch(/^Cannot reach the Orthanc server/);
  });

  it('passes through our own already-readable message', () => {
    expect(describeRequestFailure(new Error('No AI endpoint configured.'), LOOKUP)).toBe(
      'No AI endpoint configured.'
    );
  });

  it('falls back when the error carries markup or a stack instead of a message', () => {
    expect(describeRequestFailure(new Error('<html>boom</html>'), LOOKUP)).toBe(
      'Failed to look up the study in Orthanc.'
    );
    expect(describeRequestFailure({ nope: true }, LOOKUP)).toBe(
      'Failed to look up the study in Orthanc.'
    );
  });
});

describe('describeUnexpectedBody', () => {
  it('names the route and points at the configuration', () => {
    expect(describeUnexpectedBody(LOOKUP)).toBe(
      'http://orthanc:8042 answered POST /tools/lookup with an unexpected body — ' +
        'it does not look like an Orthanc server. Check that Orthanc is running and that ' +
        '"orthancUrl" in the viewer configuration points at it.'
    );
  });
});
