import dicomParser, { DataSet } from 'dicom-parser';

// dicom-parser exports this at runtime but omits it from its TypeScript declarations.
const { readPart10Header } = dicomParser as typeof dicomParser & {
  readPart10Header: (bytes: Uint8Array) => DataSet;
};

export type UploadIssue = {
  code: string;
  message: string;
  disposition: 'failed' | 'skipped' | 'warning';
  retryable?: boolean;
  details?: string;
};

const skipped = (code: string, message: string): UploadIssue => ({
  code,
  message,
  disposition: 'skipped',
});

/** Inspect only a small prefix. This is format recognition, not DICOM conformance validation. */
export function validateUploadFile(file: File, prefix: ArrayBuffer): UploadIssue | undefined {
  if (file.size === 0) {
    return {
      code: 'empty-file',
      message: 'This file is empty. Export or copy it again.',
      disposition: 'failed',
    };
  }

  const bytes = new Uint8Array(prefix);
  const text = (start: number, length: number) =>
    String.fromCharCode(...bytes.subarray(start, start + length));
  const name = file.name.toLowerCase();

  // Content takes precedence over extensions: DICOM exports often have no extension.
  if (text(128, 4) === 'DICM') {
    let dataSet;
    try {
      // Read only file meta information; do not inflate or decode the image dataset.
      dataSet = readPart10Header(bytes);
    } catch (_error) {
      // The bounded prefix may end inside an element. Leave complete validation to the server.
    }
    if (dataSet?.string('x00020002') === '1.2.840.10008.1.3.10') {
      return skipped(
        'dicom-directory',
        'DICOMDIR is a directory index. Select the folder containing the referenced DICOM files.'
      );
    }
    return;
  }

  if (name === '.ds_store' || name === 'thumbs.db' || name.startsWith('._')) {
    return skipped('auxiliary-file', 'System metadata file; no DICOM data to upload.');
  }

  if (['PK\x03\x04', 'PK\x05\x06', 'PK\x07\x08'].includes(text(0, 4))) {
    return skipped(
      'archive',
      'ZIP archives are not supported here. Extract the archive and select the folder containing the DICOM files.'
    );
  }

  const niftiMagic =
    ['n+1\0', 'ni1\0'].includes(text(344, 4)) || ['n+2\0', 'ni2\0'].includes(text(4, 4));
  const formats: [boolean, string][] = [
    [niftiMagic, 'NIfTI'],
    [text(0, 4) === 'NRRD', 'NRRD'],
    [text(0, 8) === '\x89PNG\r\n\x1a\n', 'PNG'],
    [bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff, 'JPEG'],
    [text(0, 4) === '%PDF', 'PDF'],
  ];
  const detected = formats.find(([matches]) => matches)?.[1];
  const extensionFormats: [RegExp, string][] = [
    [/\.nii(\.gz)?$/, 'NIfTI'],
    [/\.(nrrd|nhdr)$/, 'NRRD'],
    [/\.(mha|mhd)$/, 'MetaImage'],
    [/\.png$/, 'PNG'],
    [/\.jpe?g$/, 'JPEG'],
    [/\.pdf$/, 'PDF'],
    [/\.zip$/, 'ZIP'],
  ];
  const extensionFormat = extensionFormats.find(([pattern]) => pattern.test(name))?.[1];
  const format = detected || extensionFormat;
  if (format === 'ZIP') {
    return skipped(
      'archive',
      'This appears to be a ZIP archive. Extract it and select the folder containing the DICOM files.'
    );
  }
  if (format) {
    return skipped(
      `unsupported-${format.toLowerCase()}`,
      `${detected ? 'This is' : 'This appears to be'} a ${format} file. This uploader accepts DICOM files only. Select the original DICOM files or a folder containing them.`
    );
  }
  return skipped(
    'unrecognized-file',
    'Could not recognize this as a supported DICOM file. Select a DICOM export from your imaging system.'
  );
}

/** Abortable reads work with both files and sliced blobs, without retaining files in the image cache. */
export function readUploadBlob(blob: Blob, signal: AbortSignal): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => {
      reader.abort();
      reject(new DOMException('Cancelled', 'AbortError'));
    };
    if (signal.aborted) {
      abort();
      return;
    }
    signal.addEventListener('abort', abort, { once: true });
    const cleanup = () => signal.removeEventListener('abort', abort);
    reader.onload = () => {
      cleanup();
      resolve(reader.result as ArrayBuffer);
    };
    reader.onerror = () => {
      cleanup();
      reject(reader.error);
    };
    reader.onabort = cleanup;
    try {
      reader.readAsArrayBuffer(blob);
    } catch (error) {
      cleanup();
      reject(error);
    }
  });
}
