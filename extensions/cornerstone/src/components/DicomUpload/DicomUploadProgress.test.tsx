import React, { StrictMode } from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import DicomUploadProgress from './DicomUploadProgress';
import DicomFileUploader from '../../utils/DicomFileUploader';
import { dicomFile } from '../../utils/testUtils/dicomUploadFixtures';

jest.mock('@ohif/core', () =>
  jest.requireActual('../../../../../platform/core/src/services/_shared/pubSubServiceInterface')
);
jest.mock('@ohif/ui-next', () => ({
  Button: ({ children, variant, size, ...props }) => <button {...props}>{children}</button>,
}));

describe('upload report', () => {
  it('reports mixed-folder results and retries only transient failures under StrictMode', async () => {
    const dataSource = {
      store: {
        dicom: jest
          .fn()
          .mockResolvedValueOnce(undefined)
          .mockRejectedValueOnce({ status: 503 })
          .mockResolvedValue(undefined),
      },
    };
    const nested = dicomFile('slice.dcm');
    Object.defineProperty(nested, 'webkitRelativePath', { value: 'exam/series-2/slice.dcm' });
    const uploaders = [
      new DicomFileUploader(dicomFile('good.dcm'), dataSource),
      new DicomFileUploader(nested, dataSource),
      new DicomFileUploader(new File(['nifti'], 'brain.nii.gz'), dataSource),
    ];
    const close = jest.fn();
    render(
      <StrictMode>
        <DicomUploadProgress
          dicomFileUploaderArr={uploaders}
          onComplete={close}
        />
      </StrictMode>
    );
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        'Upload finished · 1 uploaded · 1 skipped · 1 failed'
      )
    );
    expect(screen.getByText('exam/series-2/slice.dcm')).toBeTruthy();
    const results = screen.getByRole('list', { name: 'Upload results' });
    expect(within(results).getByText(/appears to be a NIfTI/)).toBeTruthy();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show affected files only' }));
    expect(within(results).queryByText('good.dcm')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry failed uploads' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain('2 uploaded · 1 skipped · 0 failed')
    );
    expect(dataSource.store.dicom).toHaveBeenCalledTimes(3);
    fireEvent.click(screen.getByRole('checkbox', { name: 'Show affected files only' }));
    expect(within(results).getByText('good.dcm')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Retry failed uploads' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('explains a folder with no supported files without sending requests', async () => {
    const dataSource = { store: { dicom: jest.fn() } };
    const uploaders = [new DicomFileUploader(new File(['nifti'], 'brain.nii'), dataSource)];
    render(
      <DicomUploadProgress
        dicomFileUploaderArr={uploaders}
        onComplete={() => {}}
      />
    );
    expect(await screen.findByText(/No supported DICOM files were found/)).toBeTruthy();
    expect(dataSource.store.dicom).not.toHaveBeenCalled();
  });

  it('keeps cancelled files out of uploaded and failed counts', async () => {
    const dataSource = {
      store: {
        dicom: jest.fn((_file: ArrayBuffer, _request: XMLHttpRequest) => new Promise(() => {})),
      },
    };
    const uploaders = [new DicomFileUploader(dicomFile(), dataSource)];
    render(
      <DicomUploadProgress
        dicomFileUploaderArr={uploaders}
        onComplete={() => {}}
      />
    );
    await waitFor(() => expect(dataSource.store.dicom).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel all uploads' }));
    await waitFor(() =>
      expect(screen.getByRole('status').textContent).toContain(
        '0 uploaded · 0 skipped · 0 failed · 1 cancelled'
      )
    );
  });

  it('aborts an active request when the dialog unmounts', async () => {
    const dataSource = {
      store: {
        dicom: jest.fn((_file: ArrayBuffer, _request: XMLHttpRequest) => new Promise(() => {})),
      },
    };
    const uploaders = [new DicomFileUploader(dicomFile(), dataSource)];
    const { unmount } = render(
      <DicomUploadProgress
        dicomFileUploaderArr={uploaders}
        onComplete={() => {}}
      />
    );
    await waitFor(() => expect(dataSource.store.dicom).toHaveBeenCalledTimes(1));
    const abort = jest.spyOn(dataSource.store.dicom.mock.calls[0][1], 'abort');
    unmount();
    expect(abort).toHaveBeenCalledTimes(1);
  });
});

it('keeps the affected-files filter available after the final failure is retried', async () => {
  const dataSource = {
    store: { dicom: jest.fn().mockRejectedValueOnce({ status: 503 }).mockResolvedValue(undefined) },
  };
  const uploaders = [new DicomFileUploader(dicomFile('recovered.dcm'), dataSource)];
  render(
    <DicomUploadProgress
      dicomFileUploaderArr={uploaders}
      onComplete={() => {}}
    />
  );
  await screen.findByRole('button', { name: 'Retry failed uploads' });
  fireEvent.click(screen.getByRole('checkbox', { name: 'Show affected files only' }));
  fireEvent.click(screen.getByRole('button', { name: 'Retry failed uploads' }));
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain('1 uploaded · 0 skipped · 0 failed')
  );
  fireEvent.click(screen.getByRole('checkbox', { name: 'Show affected files only' }));
  expect(screen.getByText('recovered.dcm')).toBeTruthy();
});
