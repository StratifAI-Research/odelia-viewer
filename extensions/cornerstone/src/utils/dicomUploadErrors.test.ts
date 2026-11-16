import { getStorageIssue, getUploadError } from './dicomUploadErrors';

const failedResponse = (code: number) => ({
  '00081198': { Value: [{ '00081197': { Value: [code] } }] },
});

describe('upload server outcomes', () => {
  it.each([
    [401, 'Sign in again', true],
    [403, 'permission', false],
    [413, 'upload limit', false],
    [415, 'upload format', false],
    [400, 'rejected', false],
    [409, 'rejected', false],
    [404, 'could not be found', false],
    [429, 'Wait a moment', true],
    [500, 'server could not complete', true],
    [503, 'server could not complete', true],
    [504, 'timed out', true],
    [0, 'Could not confirm', true],
  ])('explains HTTP %s', (status, text, retryable) => {
    const issue = getUploadError({ status, message: 'request failed' });
    expect(issue.message).toContain(text);
    expect(issue).toMatchObject({ retryable, details: `HTTP ${status}` });
  });

  it.each([null, undefined, 'error', { message: '<html>secret patient metadata</html>' }])(
    'handles unknown errors without exposing arbitrary responses',
    error => {
      expect(getUploadError(error)).toMatchObject({ code: 'upload-failed', disposition: 'failed' });
      expect(JSON.stringify(getUploadError(error))).not.toContain('secret');
    }
  );

  it.each([
    [0xc122, 'encoding'],
    [0x0122, 'type of DICOM object'],
    [0xa700, 'enough resources'],
    [0xa900, 'declared object type'],
    [0xc001, 'could not read'],
    [0x0110, 'could not process'],
    [0xffff, 'rejected'],
  ])('explains DICOM rejection %s from JSON response', (code, text) => {
    expect(getStorageIssue(JSON.stringify([failedResponse(code)]), 202)).toMatchObject({
      disposition: 'failed',
      message: expect.stringContaining(text),
    });
  });

  it('reads native DICOM XML responses with a namespace', () => {
    const response =
      '<NativeDicomModel xmlns="http://dicom.nema.org/PS3.19/models/NativeDICOM"><DicomAttribute tag="00081198" vr="SQ"><Item number="1"><DicomAttribute tag="00081197" vr="US"><Value number="1">49442</Value></DicomAttribute></Item></DicomAttribute></NativeDicomModel>';
    expect(getStorageIssue(response, 202)).toMatchObject({
      disposition: 'failed',
      details: 'DICOM failure: 0xC122',
    });
  });

  it.each([0xb000, 0xb006, 0xb007])('retains stored-with-warning outcomes: %s', code => {
    expect(
      getStorageIssue({ '00081199': { Value: [{ '00081196': { Value: [code] } }] } }, 202)
    ).toMatchObject({ disposition: 'warning', code: 'storage-warning' });
  });

  it('treats an unexplained 202 as unconfirmed, not success or a duplicate', () => {
    expect(getStorageIssue('<html>proxy response</html>', 202)).toMatchObject({
      code: 'storage-unconfirmed',
      disposition: 'warning',
    });
    expect(getStorageIssue('', 200)).toBeUndefined();
  });

  it('uses per-instance failure reasons in HTTP failures', () => {
    expect(getUploadError({ status: 409, response: failedResponse(0x0122) })).toMatchObject({
      message: expect.stringContaining('SOP class'),
      details: 'HTTP 409 · DICOM failure: 0x0122',
    });
  });

  it('retains other storage failures and malformed response fallbacks', () => {
    expect(getStorageIssue({ '0008119A': { Value: [{}] } }, 200)).toMatchObject({
      disposition: 'failed',
    });
    expect(getStorageIssue('not JSON', 202)).toMatchObject({ disposition: 'warning' });
    expect(getStorageIssue(null, 200)).toBeUndefined();
  });
});
