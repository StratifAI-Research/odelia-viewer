import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import DicomUpload from './DicomUpload';
import { dicomFile } from '../../utils/testUtils/dicomUploadFixtures';

jest.mock('@ohif/core', () =>
  jest.requireActual('../../../../../platform/core/src/services/_shared/pubSubServiceInterface')
);
jest.mock('@ohif/ui-next', () => ({
  Button: ({ children, variant, size, ...props }) => <button {...props}>{children}</button>,
}));

function setup() {
  const store = jest.fn().mockResolvedValue(undefined);
  const onStarted = jest.fn();
  const view = render(
    <DicomUpload
      dataSource={{ store: { dicom: store } }}
      onComplete={() => {}}
      onStarted={onStarted}
    />
  );
  return { ...view, store, onStarted };
}

it('accepts extensionless DICOM through the native picker and explains NIfTI skips', async () => {
  const { container, store, onStarted } = setup();
  fireEvent.change(container.querySelector('input[type="file"]'), {
    target: { files: [dicomFile('slice'), new File(['nifti'], 'brain.nii.gz')] },
  });
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain('1 uploaded · 1 skipped · 0 failed')
  );
  expect(store).toHaveBeenCalledTimes(1);
  expect(onStarted).toHaveBeenCalledTimes(1);
});

it('explains directory selection failures before starting an upload', async () => {
  const { store, onStarted } = setup();
  fireEvent.drop(screen.getByText('or drag DICOM files or folders here').parentElement, {
    dataTransfer: {
      types: ['Files'],
      items: [
        {
          kind: 'file',
          webkitGetAsEntry: () => ({
            isDirectory: true,
            createReader: () => ({
              readEntries: (_resolve, reject) => reject(new Error('unreadable')),
            }),
          }),
        },
      ],
    },
  });
  expect((await screen.findByRole('alert')).textContent).toContain(
    'Could not read the selected files or folder'
  );
  expect(store).not.toHaveBeenCalled();
  expect(onStarted).not.toHaveBeenCalled();
});

it('explains empty folder selections and allows another selection', async () => {
  const { container, store } = setup();
  fireEvent.change(container.querySelector('input[webkitdirectory]'), { target: { files: [] } });
  expect((await screen.findByRole('alert')).textContent).toContain('No readable files');
  fireEvent.change(container.querySelector('input[webkitdirectory]'), {
    target: { files: [dicomFile()] },
  });
  await waitFor(() => expect(screen.getByRole('status').textContent).toContain('1 uploaded'));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(store).toHaveBeenCalledTimes(1);
});
