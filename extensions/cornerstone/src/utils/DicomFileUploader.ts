import { PubSubService } from '@ohif/core';
import { getStorageIssue, getUploadError } from './dicomUploadErrors';
import { readUploadBlob, validateUploadFile, UploadIssue } from './dicomUploadValidation';

export const EVENTS = {
  PROGRESS: 'event:DicomFileUploader:progress',
  STATUS: 'event:DicomFileUploader:status',
};

export interface DicomFileUploaderProgressEvent {
  fileId: string;
  percentComplete: number;
}

export enum UploadStatus {
  NotStarted,
  InProgress,
  Success,
  Failed,
  Cancelled,
  Validating,
  Skipped,
  Warning,
}

export class UploadRejection extends Error {
  constructor(
    public status: UploadStatus,
    public issue: UploadIssue
  ) {
    super(issue.message);
    this.name = 'UploadRejection';
  }
}

export type UploadFile = File & { path?: string };
type UploadDataSource = {
  store: { dicom: (file: ArrayBuffer, request: XMLHttpRequest) => Promise<unknown> };
};

let nextFileId = 0;

export default class DicomFileUploader extends PubSubService {
  private _fileId = `upload-${nextFileId++}`;
  private _loadPromise?: Promise<void>;
  private _abortController = new AbortController();
  private _status = UploadStatus.NotStarted;
  private _percentComplete = 0;
  private _issue?: UploadIssue;

  constructor(
    private _file: UploadFile,
    private _dataSource: UploadDataSource
  ) {
    super(EVENTS);
  }

  getFileId(): string {
    return this._fileId;
  }

  getFileName(): string {
    return this._file.webkitRelativePath || this._file.path?.replace(/^\/+/, '') || this._file.name;
  }

  getFileSize(): number {
    return this._file.size;
  }

  getStatus(): UploadStatus {
    return this._status;
  }

  getPercentComplete(): number {
    return this._percentComplete;
  }

  getIssue(): UploadIssue | undefined {
    return this._issue;
  }

  isComplete(): boolean {
    return ![UploadStatus.NotStarted, UploadStatus.Validating, UploadStatus.InProgress].includes(
      this._status
    );
  }

  canRetry(): boolean {
    return this._status === UploadStatus.Failed && !!this._issue?.retryable;
  }

  resetForRetry(): void {
    if (!this.canRetry()) {
      return;
    }
    this._abortController = new AbortController();
    this._loadPromise = undefined;
    this._percentComplete = 0;
    this._setStatus(UploadStatus.NotStarted);
  }

  cancel(): void {
    if (this.isComplete()) {
      return;
    }
    this._abortController.abort();
    this._setStatus(UploadStatus.Cancelled);
  }

  load(): Promise<void> {
    if (!this._loadPromise) {
      this._loadPromise = this._run();
    }
    return this._loadPromise;
  }

  private _setStatus(status: UploadStatus, issue?: UploadIssue): void {
    this._status = status;
    this._issue = issue;
    this._broadcastEvent(EVENTS.STATUS, { fileId: this._fileId });
  }

  private async _read(blob: Blob): Promise<ArrayBuffer> {
    try {
      return await readUploadBlob(blob, this._abortController.signal);
    } catch (_error) {
      throw new UploadRejection(UploadStatus.Failed, {
        code: 'unreadable-file',
        disposition: 'failed',
        message:
          'Could not read this file. Check that it is available on your device, then select it again.',
        retryable: true,
      });
    }
  }

  private async _run(): Promise<void> {
    const signal = this._abortController.signal;
    try {
      if (signal.aborted) {
        throw new DOMException('Cancelled', 'AbortError');
      }
      this._setStatus(UploadStatus.Validating);
      const prefix = await this._read(this._file.slice(0, 64 * 1024));
      const issue = validateUploadFile(this._file, prefix);
      if (issue) {
        throw new UploadRejection(
          issue.disposition === 'skipped' ? UploadStatus.Skipped : UploadStatus.Failed,
          issue
        );
      }
      const dicomFile =
        this._file.size <= prefix.byteLength ? prefix : await this._read(this._file);
      if (signal.aborted) {
        throw new DOMException('Cancelled', 'AbortError');
      }
      this._setStatus(UploadStatus.InProgress);
      const request = new XMLHttpRequest();
      const response = await this._store(dicomFile, request);
      if (signal.aborted) {
        throw new DOMException('Cancelled', 'AbortError');
      }
      const storageIssue = getStorageIssue(response ?? request.response, request.status);
      if (storageIssue?.disposition === 'failed') {
        throw new UploadRejection(UploadStatus.Failed, storageIssue);
      }
      this._percentComplete = 100;
      this._setStatus(storageIssue ? UploadStatus.Warning : UploadStatus.Success, storageIssue);
    } catch (error) {
      if (signal.aborted) {
        this._setStatus(UploadStatus.Cancelled);
        throw new UploadRejection(UploadStatus.Cancelled, {
          code: 'cancelled',
          disposition: 'failed',
          message: 'Cancelled',
        });
      }
      const rejection =
        error instanceof UploadRejection
          ? error
          : new UploadRejection(UploadStatus.Failed, getUploadError(error));
      this._setStatus(rejection.status, rejection.issue);
      throw rejection;
    }
  }

  private async _store(dicomFile: ArrayBuffer, request: XMLHttpRequest): Promise<unknown> {
    const signal = this._abortController.signal;
    let abort: () => void;
    let timeout: () => void;
    let networkError: () => void;
    const progress = (event: ProgressEvent) => {
      if (event.lengthComputable && !signal.aborted) {
        // Sending all bytes is not confirmation that the server stored the instance.
        this._percentComplete = Math.min(99, Math.round((100 * event.loaded) / event.total));
        this._broadcastEvent(EVENTS.PROGRESS, {
          fileId: this._fileId,
          percentComplete: this._percentComplete,
        });
      }
    };
    const interrupted = new Promise<never>((_resolve, reject) => {
      abort = () => {
        reject(new DOMException('Cancelled', 'AbortError'));
        request.abort();
      };
      timeout = () =>
        reject(
          new UploadRejection(UploadStatus.Failed, {
            ...getUploadError({ status: 408 }),
            code: 'request-timeout',
            details: 'Browser request timeout; no HTTP response received.',
          })
        );
      networkError = () =>
        reject(new UploadRejection(UploadStatus.Failed, getUploadError({ status: 0 })));
      signal.addEventListener('abort', abort, { once: true });
      request.addEventListener('timeout', timeout);
      request.addEventListener('error', networkError);
      request.upload.addEventListener('progress', progress);
    });
    try {
      const stored = this._dataSource.store.dicom(dicomFile, request).catch(async reason => {
        // dicomweb-client rejects at readyState 4, before the browser dispatches timeout/error.
        // Give that terminal event a chance to supply the more specific failure reason.
        if ((reason?.status ?? reason?.request?.status) === 0 && !signal.aborted) {
          await new Promise(resolve => setTimeout(resolve, 0));
        }
        throw reason;
      });
      return await Promise.race([stored, interrupted]);
    } finally {
      signal.removeEventListener('abort', abort);
      request.removeEventListener('timeout', timeout);
      request.removeEventListener('error', networkError);
      request.upload.removeEventListener('progress', progress);
    }
  }
}
