import type { UploadIssue } from './dicomUploadValidation';

type DicomAttribute = { Value?: unknown[] };
type DicomDataset = Record<string, DicomAttribute>;

function parseResponse(response: unknown): DicomDataset | undefined {
  if (typeof response === 'string') {
    try {
      return parseResponse(JSON.parse(response));
    } catch {
      // DICOMweb permits both DICOM JSON and Native DICOM XML responses.
      if (!response.trim().startsWith('<')) {
        return;
      }
      const document = new DOMParser().parseFromString(response, 'application/xml');
      if (document.getElementsByTagName('parsererror').length) {
        return;
      }
      const root = document.documentElement;
      if (root.localName !== 'NativeDicomModel') {
        return;
      }
      const readDataset = (element: Element): DicomDataset => {
        const dataset: DicomDataset = {};
        Array.from(element.children).forEach(attribute => {
          if (attribute.localName !== 'DicomAttribute') {
            return;
          }
          const tag = attribute.getAttribute('tag')?.toUpperCase();
          if (tag) {
            dataset[tag] = {
              Value: Array.from(attribute.children)
                .filter(child => ['Item', 'Value'].includes(child.localName))
                .map(child =>
                  child.localName === 'Item' ? readDataset(child) : child.textContent
                ),
            };
          }
        });
        return dataset;
      };
      return readDataset(root);
    }
  }
  if (Array.isArray(response)) {
    return parseResponse(response[0]);
  }
  if (response && typeof response === 'object') {
    return response as DicomDataset;
  }
}

function reasonIssue(value: unknown, warning: boolean): UploadIssue {
  // US values are numbers in DICOM JSON and decimal text in Native DICOM XML.
  const code = typeof value === 'number' ? value : Number(value);
  let message = warning
    ? 'The server stored this file with a warning. Review the upload details.'
    : 'The server rejected this DICOM file. Contact your administrator with the upload details.';
  let retryable = false;
  if (!warning) {
    if (code >= 0xa700 && code <= 0xa7ff) {
      message =
        'The server does not have enough resources to store this file. Contact your administrator, then retry.';
      retryable = true;
    } else if (code === 0xc122) {
      message =
        'The server does not support this DICOM encoding (transfer syntax). Export using a supported encoding.';
    } else if (code === 0x0122) {
      message =
        'The server does not support this type of DICOM object (SOP class). Contact your administrator.';
    } else if (code >= 0xa900 && code <= 0xa9ff) {
      message =
        'The DICOM data does not match its declared object type. Export the file again or contact your administrator.';
    } else if (code >= 0xc000 && code <= 0xcfff) {
      message =
        'The server could not read the DICOM data. Export the file again or contact your administrator.';
    } else if (code === 0x0110) {
      message =
        'The server could not process this file. Try again; if it persists, contact your administrator.';
      retryable = true;
    }
  } else if (code === 0xb000) {
    message = 'Uploaded with a warning: the server changed some DICOM metadata.';
  } else if (code === 0xb006) {
    message = 'Uploaded with a warning: the server discarded some DICOM metadata.';
  } else if (code === 0xb007) {
    message = 'Uploaded with a warning: the data does not match its declared DICOM object type.';
  }
  return {
    code: warning ? 'storage-warning' : 'storage-rejected',
    disposition: warning ? 'warning' : 'failed',
    message,
    retryable,
    details:
      Number.isInteger(code) && value != null
        ? `DICOM ${warning ? 'warning' : 'failure'}: 0x${code.toString(16).toUpperCase().padStart(4, '0')}`
        : undefined,
  };
}

export function getStorageIssue(response: unknown, status?: number): UploadIssue | undefined {
  const dataset = parseResponse(response);
  for (const tag of ['00081198', '0008119A']) {
    const failures = dataset?.[tag]?.Value;
    if (Array.isArray(failures) && failures.length) {
      return reasonIssue((failures[0] as DicomDataset)?.['00081197']?.Value?.[0], false);
    }
  }
  const stored = dataset?.['00081199']?.Value;
  if (Array.isArray(stored)) {
    const warning = stored.find(item => (item as DicomDataset)?.['00081196']);
    if (warning) {
      return reasonIssue((warning as DicomDataset)['00081196'].Value?.[0], true);
    }
  }
  if (status === 202) {
    return {
      code: 'storage-unconfirmed',
      disposition: 'warning',
      message:
        'The server reported upload warnings or failures. Storage could not be fully confirmed; check the study list or contact your administrator.',
      details: 'HTTP 202',
    };
  }
}

export function getUploadError(reason: unknown): UploadIssue {
  const error = reason as { status?: number; request?: XMLHttpRequest; response?: unknown } | null;
  const status = error?.status ?? error?.request?.status;
  const storageIssue = getStorageIssue(error?.response ?? error?.request?.response);
  if (storageIssue?.disposition === 'failed') {
    return {
      ...storageIssue,
      details: [status && `HTTP ${status}`, storageIssue.details].filter(Boolean).join(' · '),
    };
  }
  let message =
    'The upload could not be completed. Try again; if it persists, contact your administrator.';
  let retryable = true;
  switch (status) {
    case 0:
      message =
        'Could not confirm that the upload completed. Check your connection and the study list before trying again.';
      break;
    case 401:
      message = 'Authentication required. Sign in again to continue uploading.';
      break;
    case 403:
      message = 'You do not have permission to upload to this server. Contact your administrator.';
      break;
    case 413:
      message = 'This file exceeds the server’s upload limit. Contact your administrator.';
      retryable = false;
      break;
    case 400:
    case 409:
      message =
        'The server rejected this upload. It may contain invalid or unsupported DICOM data. Contact your administrator with the upload details.';
      retryable = false;
      break;
    case 415:
      message =
        'The server does not support this upload format. Contact your administrator with the upload details.';
      retryable = false;
      break;
    case 404:
      message = 'The upload service could not be found. Contact your administrator.';
      retryable = false;
      break;
    case 408:
    case 504:
      message =
        'The upload timed out. Check the study list before retrying; the file may already have been stored.';
      break;
    case 429:
      message = 'The server is receiving too many requests. Wait a moment, then retry.';
      break;
    default:
      if (status >= 500) {
        message =
          'The server could not complete the upload. Try again later; if it persists, contact your administrator.';
      }
  }
  // Do not expose raw server HTML, request headers, or patient metadata in error details.
  return {
    code: status == null ? 'upload-failed' : `http-${status}`,
    disposition: 'failed',
    message,
    retryable,
    details: status == null ? undefined : `HTTP ${status}`,
  };
}
