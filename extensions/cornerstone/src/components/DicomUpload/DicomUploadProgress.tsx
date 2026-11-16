import React, { useEffect, useReducer, useState } from 'react';
import { Button } from '@ohif/ui-next';
import DicomFileUploader, { EVENTS, UploadStatus } from '../../utils/DicomFileUploader';
import { startUploadQueue } from '../../utils/dicomUploadQueue';
import DicomUploadProgressItem from './DicomUploadProgressItem';

function DicomUploadProgress({
  dicomFileUploaderArr: uploaders,
  onComplete,
}: {
  dicomFileUploaderArr: DicomFileUploader[];
  onComplete: () => void;
}) {
  const [, refresh] = useReducer(value => value + 1, 0);
  const [attempt, setAttempt] = useState(0);
  const [showAffectedOnly, setShowAffectedOnly] = useState(false);

  useEffect(() => {
    const subscriptions = uploaders.map(uploader => uploader.subscribe(EVENTS.STATUS, refresh));
    return () => subscriptions.forEach(subscription => subscription.unsubscribe());
  }, [uploaders]);

  useEffect(() => {
    const queue = startUploadQueue(uploaders);
    return () => queue.stop();
  }, [uploaders, attempt]);

  useEffect(() => {
    // Do not leave reads/requests running after the modal is unmounted.
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (uploaders.some(uploader => !uploader.isComplete())) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      // Queue startup is deferred, so only cancel reads/requests that actually started.
      uploaders.forEach(uploader => {
        if ([UploadStatus.Validating, UploadStatus.InProgress].includes(uploader.getStatus())) {
          uploader.cancel();
        }
      });
    };
  }, [uploaders]);

  const count = (status: UploadStatus) =>
    uploaders.filter(uploader => uploader.getStatus() === status).length;
  const completed = uploaders.filter(uploader => uploader.isComplete()).length;
  const finished = completed === uploaders.length;
  const success = count(UploadStatus.Success);
  const skipped = count(UploadStatus.Skipped);
  const failed = count(UploadStatus.Failed);
  const warnings = count(UploadStatus.Warning);
  const cancelled = count(UploadStatus.Cancelled);
  const affected = (uploader: DicomFileUploader) =>
    [
      UploadStatus.Failed,
      UploadStatus.Skipped,
      UploadStatus.Warning,
      UploadStatus.Cancelled,
    ].includes(uploader.getStatus());
  const groups = new Map<string, number>();
  uploaders.forEach(uploader => {
    const issue = uploader.getIssue();
    if (issue) {
      groups.set(issue.message, (groups.get(issue.message) || 0) + 1);
    }
  });
  const retry = () => {
    uploaders.forEach(uploader => uploader.resetForRetry());
    setAttempt(value => value + 1);
  };

  return (
    <div className="text-foreground flex min-h-0 grow flex-col">
      <div className="border-input border-b p-4">
        <p
          data-cy="dicom-upload-summary"
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="font-medium"
        >
          {finished ? 'Upload finished' : `Processing ${completed} of ${uploaders.length} files`}
          {` · ${success} uploaded · ${skipped} skipped · ${failed} failed`}
          {warnings > 0 && ` · ${warnings} need review`}
          {cancelled > 0 && ` · ${cancelled} cancelled`}
        </p>
        {!finished && (
          <progress
            className="mt-2 w-full"
            aria-label="Files processed"
            value={completed}
            max={uploaders.length}
          />
        )}
        {finished && skipped === uploaders.length && (
          <p className="mt-2">
            No supported DICOM files were found in this selection. Select the original DICOM files
            or a folder containing them.
          </p>
        )}
        {groups.size > 0 && (
          <details className="mt-2">
            <summary className="cursor-pointer">Reasons ({groups.size})</summary>
            <ul className="mt-2 space-y-1 text-sm">
              {Array.from(groups, ([message, count]) => (
                <li key={message}>
                  {count} {count === 1 ? 'file' : 'files'}: {message}
                </li>
              ))}
            </ul>
          </details>
        )}
        {(showAffectedOnly || skipped + failed + warnings + cancelled > 0) && (
          <label className="mt-3 flex cursor-pointer items-center gap-2 text-sm">
            <input
              data-cy="dicom-upload-affected"
              type="checkbox"
              checked={showAffectedOnly}
              onChange={event => setShowAffectedOnly(event.target.checked)}
            />
            Show affected files only
          </label>
        )}
      </div>
      <ul
        data-cy="dicom-upload-results"
        aria-label="Upload results"
        className="ohif-scrollbar min-h-0 grow overflow-y-auto"
      >
        {uploaders
          .filter(uploader => !showAffectedOnly || affected(uploader))
          .map(uploader => (
            <DicomUploadProgressItem
              key={uploader.getFileId()}
              dicomFileUploader={uploader}
            />
          ))}
      </ul>
      <div className="border-input flex justify-end gap-2 border-t p-3">
        {finished ? (
          <>
            {uploaders.some(uploader => uploader.canRetry()) && (
              <Button
                data-cy="dicom-upload-retry"
                variant="secondary"
                onClick={retry}
              >
                Retry failed uploads
              </Button>
            )}
            <Button
              data-cy="dicom-upload-close"
              onClick={onComplete}
            >
              Close
            </Button>
          </>
        ) : (
          <Button
            data-cy="dicom-upload-cancel-all"
            variant="secondary"
            onClick={() => uploaders.forEach(uploader => uploader.cancel())}
          >
            Cancel all uploads
          </Button>
        )}
      </div>
    </div>
  );
}

export default DicomUploadProgress;
