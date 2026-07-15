// @ohif/core is a webpack external, unresolvable in this package's jest env.
// downloadCSVReport only touches DicomMetadataStore in its main path, which the
// tests below do not exercise.
jest.mock(
  '@ohif/core',
  () => ({ DicomMetadataStore: { getStudy: () => undefined, getSeries: () => undefined } }),
  { virtual: true }
);

import {
  _escapeCsvValue,
  _createAndDownloadFile,
  _getCommonRowItems,
} from './downloadCSVReport';

describe('_escapeCsvValue', () => {
  it('wraps values containing comma / quote / newline per RFC 4180', () => {
    expect(_escapeCsvValue('a,b')).toBe('"a,b"');
    expect(_escapeCsvValue('a"b')).toBe('"a""b"');
    expect(_escapeCsvValue('a\nb')).toBe('"a\nb"');
  });

  it('leaves # untouched (the # truncation was a transport bug, not escaping)', () => {
    expect(_escapeCsvValue('Smith#123')).toBe('Smith#123');
  });

  it('neutralizes formula-injection prefixes but preserves plain numbers', () => {
    expect(_escapeCsvValue('=cmd')).toBe("'=cmd");
    expect(_escapeCsvValue('-12.5')).toBe('-12.5');
  });

  it('renders null/undefined as an empty field', () => {
    expect(_escapeCsvValue(null)).toBe('');
    expect(_escapeCsvValue(undefined)).toBe('');
  });
});

describe('_getCommonRowItems (LAB-M9 metadata guards)', () => {
  const seriesWith = (patientName: any, patientID = 'PID') => ({
    instances: [{ PatientID: patientID, PatientName: patientName }],
  });

  it('reads PatientName.Alphabetic from a PN object', () => {
    const row = _getCommonRowItems({ referenceStudyUID: 'S1' }, seriesWith({ Alphabetic: 'Doe^Jane' }));
    expect(row['Patient Name']).toBe('Doe^Jane');
  });

  it('accepts a plain-string PatientName', () => {
    const row = _getCommonRowItems({ referenceStudyUID: 'S1' }, seriesWith('Doe^Jane'));
    expect(row['Patient Name']).toBe('Doe^Jane');
  });

  it('exports empty (not "[object Object]") for a PN object without Alphabetic', () => {
    const row = _getCommonRowItems({ referenceStudyUID: 'S1' }, seriesWith({ Ideographic: '山田' }));
    expect(row['Patient Name']).toBe('');
  });

  it('does not throw and returns empty fields when series/instance metadata is missing', () => {
    expect(() => _getCommonRowItems({ referenceStudyUID: 'S1' }, undefined)).not.toThrow();
    const row = _getCommonRowItems({ referenceStudyUID: 'S1' }, undefined);
    expect(row['Patient ID']).toBe('');
    expect(row['Patient Name']).toBe('');
    expect(row.StudyInstanceUID).toBe('S1');
  });
});

describe('_createAndDownloadFile', () => {
  let originalBlob: any;
  let capturedParts: any;

  beforeEach(() => {
    originalBlob = global.Blob;
    capturedParts = null;
    (global as any).Blob = function (parts: any[], opts: any) {
      capturedParts = parts;
      this.type = opts?.type;
    };
    (global as any).URL.createObjectURL = jest.fn(() => 'blob:mock-url');
    (global as any).URL.revokeObjectURL = jest.fn();
  });

  afterEach(() => {
    global.Blob = originalBlob;
    jest.restoreAllMocks();
  });

  it('downloads via a Blob object URL (not a data: URI), preserving #, and cleans up (LAB-M1)', () => {
    const anchor: any = {
      setAttribute: jest.fn(),
      click: jest.fn(),
      remove: jest.fn(),
    };
    jest.spyOn(document, 'createElement').mockReturnValue(anchor);
    jest.spyOn(document.body, 'appendChild').mockImplementation((n: any) => n);

    _createAndDownloadFile('Patient#1,x\n"q"');

    // Blob content preserves the raw text (including '#') verbatim.
    expect(capturedParts[0]).toContain('Patient#1,x\n"q"');

    // href is the object URL, never a data: URI.
    const hrefCall = anchor.setAttribute.mock.calls.find((c: any[]) => c[0] === 'href');
    expect(hrefCall[1]).toBe('blob:mock-url');
    expect(hrefCall[1].startsWith('data:')).toBe(false);

    // Anchor is removed and the object URL revoked after the click.
    expect(anchor.click).toHaveBeenCalled();
    expect(anchor.remove).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });
});
