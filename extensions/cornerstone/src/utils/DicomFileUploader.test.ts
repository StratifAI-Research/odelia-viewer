import { waitFor } from '@testing-library/dom';
import DicomFileUploader, { UploadStatus } from './DicomFileUploader';
import { startUploadQueue } from './dicomUploadQueue';
import { dicomFile } from './testUtils/dicomUploadFixtures';

jest.mock('@ohif/core', () =>
  jest.requireActual('../../../../platform/core/src/services/_shared/pubSubServiceInterface')
);

describe('DICOM upload lifecycle', () => {
  const source = () => ({ store: { dicom: jest.fn().mockResolvedValue(undefined) } });

  it('does not send unsupported or empty files to the server', async () => {
    const dataSource = source();
    const nifti = new DicomFileUploader(new File(['nifti'], 'volume.nii.gz'), dataSource);
    const empty = new DicomFileUploader(new File([], 'empty.dcm'), dataSource);
    const good = new DicomFileUploader(dicomFile('scan'), dataSource);
    await startUploadQueue([nifti, empty, good]).done;
    expect(nifti.getStatus()).toBe(UploadStatus.Skipped);
    expect(empty.getStatus()).toBe(UploadStatus.Failed);
    expect(good.getStatus()).toBe(UploadStatus.Success);
    expect(dataSource.store.dicom).toHaveBeenCalledTimes(1);
  });

  it('retains local file read failures', async () => {
    const file = dicomFile();
    jest.spyOn(file, 'slice').mockReturnValue({} as Blob);
    const uploader = new DicomFileUploader(file, source());
    await expect(uploader.load()).rejects.toMatchObject({ issue: { code: 'unreadable-file' } });
    expect(uploader.canRetry()).toBe(true);
  });

  it('reports DICOM failures even when the HTTP request resolves', async () => {
    const dataSource = source();
    dataSource.store.dicom.mockResolvedValue({
      '00081198': { Value: [{ '00081197': { Value: [0xc122] } }] },
    });
    const uploader = new DicomFileUploader(dicomFile(), dataSource);
    await expect(uploader.load()).rejects.toMatchObject({ issue: { code: 'storage-rejected' } });
    expect(uploader.getStatus()).toBe(UploadStatus.Failed);
    expect(uploader.canRetry()).toBe(false);
  });

  it('keeps ambiguous 202 outcomes separate from success', async () => {
    const dataSource = source();
    dataSource.store.dicom.mockImplementation(async (_file, request) => {
      Object.defineProperty(request, 'status', { value: 202 });
      return '';
    });
    const uploader = new DicomFileUploader(dicomFile(), dataSource);
    await uploader.load();
    expect(uploader.getStatus()).toBe(UploadStatus.Warning);
    expect(uploader.getIssue()?.code).toBe('storage-unconfirmed');
  });

  it('retries transient failures using a fresh request and does not repeat successful files', async () => {
    const dataSource = source();
    dataSource.store.dicom.mockRejectedValueOnce({ status: 503 });
    const failed = new DicomFileUploader(dicomFile('failed.dcm'), dataSource);
    const success = new DicomFileUploader(dicomFile('success.dcm'), dataSource);
    await startUploadQueue([failed, success], 1).done;
    expect(failed.canRetry()).toBe(true);
    failed.resetForRetry();
    success.resetForRetry();
    await startUploadQueue([failed, success]).done;
    expect(failed.getStatus()).toBe(UploadStatus.Success);
    expect(dataSource.store.dicom).toHaveBeenCalledTimes(3);
    expect(dataSource.store.dicom.mock.calls[2][1]).not.toBe(
      dataSource.store.dicom.mock.calls[0][1]
    );
  });

  it('bounds concurrent requests and continues after failures', async () => {
    const dataSource = source();
    const releases: (() => void)[] = [];
    let active = 0;
    let peak = 0;
    dataSource.store.dicom.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          active++;
          peak = Math.max(active, peak);
          releases.push(() => {
            active--;
            resolve();
          });
        })
    );
    const uploaders = Array.from(
      { length: 5 },
      () => new DicomFileUploader(dicomFile(), dataSource)
    );
    const queue = startUploadQueue(uploaders, 2);
    await waitFor(() => expect(releases).toHaveLength(2));
    releases[0]();
    await waitFor(() => expect(releases).toHaveLength(3));
    releases[1]();
    releases[2]();
    await waitFor(() => expect(releases).toHaveLength(5));
    releases[3]();
    releases[4]();
    await queue.done;
    expect(peak).toBe(2);
  });

  it('cancels queued and in-flight files without waiting for the data source to settle', async () => {
    const dataSource = source();
    dataSource.store.dicom.mockImplementation(() => new Promise(() => {}));
    const uploaders = Array.from(
      { length: 4 },
      () => new DicomFileUploader(dicomFile(), dataSource)
    );
    const queue = startUploadQueue(uploaders, 1);
    await waitFor(() => expect(dataSource.store.dicom).toHaveBeenCalledTimes(1));
    const request = dataSource.store.dicom.mock.calls[0][1];
    const abort = jest.spyOn(request, 'abort');
    uploaders.forEach(uploader => uploader.cancel());
    await queue.done;
    expect(abort).toHaveBeenCalledTimes(1);
    expect(uploaders.every(uploader => uploader.getStatus() === UploadStatus.Cancelled)).toBe(true);
    expect(dataSource.store.dicom).toHaveBeenCalledTimes(1);
  });

  it.each(['error', 'timeout'])('settles the upload after an XHR %s event', async event => {
    const dataSource = source();
    dataSource.store.dicom.mockImplementation(() => new Promise(() => {}));
    const uploader = new DicomFileUploader(dicomFile(), dataSource);
    const result = uploader.load().catch(error => error);
    await waitFor(() => expect(dataSource.store.dicom).toHaveBeenCalledTimes(1));
    dataSource.store.dicom.mock.calls[0][1].dispatchEvent(new Event(event));
    expect(await result).toMatchObject({ status: UploadStatus.Failed });
    expect(uploader.canRetry()).toBe(true);
  });

  it('keeps 100% of bytes sent in progress until storage is confirmed', async () => {
    const dataSource = source();
    let finish: () => void;
    dataSource.store.dicom.mockImplementation(
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        })
    );
    const uploader = new DicomFileUploader(dicomFile(), dataSource);
    const result = uploader.load();
    await waitFor(() => expect(dataSource.store.dicom).toHaveBeenCalledTimes(1));
    dataSource.store.dicom.mock.calls[0][1].upload.dispatchEvent(
      new ProgressEvent('progress', { lengthComputable: true, loaded: 100, total: 100 })
    );
    expect(uploader.getStatus()).toBe(UploadStatus.InProgress);
    expect(uploader.getPercentComplete()).toBeLessThan(100);
    finish();
    await result;
    expect(uploader.getPercentComplete()).toBe(100);
  });
});

it('prefers the native timeout event over an earlier status-zero rejection', async () => {
  let rejectStore: (reason: unknown) => void;
  let request: XMLHttpRequest;
  const dataSource = {
    store: {
      dicom: jest.fn((_file, xhr) => {
        request = xhr;
        return new Promise((_resolve, reject) => {
          rejectStore = reject;
        });
      }),
    },
  };
  const uploader = new DicomFileUploader(dicomFile(), dataSource);
  const result = uploader.load().catch(error => error);
  await waitFor(() => expect(dataSource.store.dicom).toHaveBeenCalledTimes(1));
  rejectStore({ status: 0, request });
  // Browsers run microtasks between readyState 4 and the terminal timeout event.
  for (let i = 0; i < 8; i++) await Promise.resolve();
  request.dispatchEvent(new Event('timeout'));
  expect(await result).toMatchObject({ issue: { code: 'request-timeout' } });
});
