import React, { memo, useEffect, useReducer } from 'react';
import { Button } from '@ohif/ui-next';
import DicomFileUploader, { EVENTS, UploadStatus } from '../../utils/DicomFileUploader';

export const uploadStatusLabels: Record<UploadStatus, string> = {
  [UploadStatus.NotStarted]: 'Queued',
  [UploadStatus.Validating]: 'Checking file',
  [UploadStatus.InProgress]: 'Uploading',
  [UploadStatus.Success]: 'Uploaded',
  [UploadStatus.Failed]: 'Failed',
  [UploadStatus.Cancelled]: 'Cancelled',
  [UploadStatus.Skipped]: 'Skipped',
  [UploadStatus.Warning]: 'Needs review',
};

const DicomUploadProgressItem = memo(function DicomUploadProgressItem({
  dicomFileUploader: uploader,
}: {
  dicomFileUploader: DicomFileUploader;
}) {
  const [, refresh] = useReducer(value => value + 1, 0);
  useEffect(() => {
    const subscriptions = [
      uploader.subscribe(EVENTS.STATUS, refresh),
      uploader.subscribe(EVENTS.PROGRESS, refresh),
    ];
    return () => subscriptions.forEach(subscription => subscription.unsubscribe());
  }, [uploader]);

  const status = uploader.getStatus();
  const issue = uploader.getIssue();
  return (
    <li
      data-cy="dicom-upload-result"
      className="border-input border-b p-3 text-sm"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="min-w-0 break-all font-medium">{uploader.getFileName()}</span>
        <span
          className={
            status === UploadStatus.Failed
              ? 'text-destructive shrink-0'
              : 'text-muted-foreground shrink-0'
          }
        >
          {uploadStatusLabels[status]}
          {status === UploadStatus.InProgress && ` ${uploader.getPercentComplete()}%`}
        </span>
        {!uploader.isComplete() && (
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Cancel ${uploader.getFileName()}`}
            onClick={() => uploader.cancel()}
          >
            Cancel
          </Button>
        )}
      </div>
      {issue && <p className="mt-1">{issue.message}</p>}
      {status === UploadStatus.Cancelled && (
        <p className="text-muted-foreground mt-1">
          Cancelled. Files already received by the server are not removed.
        </p>
      )}
      {issue?.details && (
        <details className="text-muted-foreground mt-1">
          <summary
            data-cy="dicom-upload-details"
            className="cursor-pointer"
          >
            Technical details
          </summary>
          <p>{issue.details}</p>
        </details>
      )}
    </li>
  );
});

export default DicomUploadProgressItem;
