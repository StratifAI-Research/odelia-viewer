import React, { useCallback, useRef, useState } from 'react';
import { ReactElement } from 'react';
import Dropzone, { DropEvent } from 'react-dropzone';
import { collectUploadFiles } from '../../utils/collectUploadFiles';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import DicomFileUploader, { UploadFile } from '../../utils/DicomFileUploader';
import DicomUploadProgress from './DicomUploadProgress';
import { Button } from '@ohif/ui-next';

type DicomUploadProps = {
  dataSource;
  onComplete: () => void;
  onStarted: () => void;
};

const directoryAttributes = { webkitdirectory: '', mozdirectory: '' };

function DicomUpload({ dataSource, onComplete, onStarted }: DicomUploadProps): ReactElement {
  const baseClassNames =
    'min-h-[375px] flex flex-col bg-background select-none rounded-lg overflow-hidden';
  const [dicomFileUploaderArr, setDicomFileUploaderArr] = useState<DicomFileUploader[]>([]);
  const [selectionError, setSelectionError] = useState('');
  const selectionFailed = useRef(false);

  const onDrop = useCallback(
    (acceptedFiles: UploadFile[]) => {
      if (selectionFailed.current) {
        return;
      }
      if (!acceptedFiles.length) {
        setSelectionError(
          'No readable files were found in this selection. Select DICOM files or a folder containing them.'
        );
        return;
      }
      setSelectionError('');
      onStarted();
      setDicomFileUploaderArr(acceptedFiles.map(file => new DicomFileUploader(file, dataSource)));
    },
    [dataSource, onStarted]
  );

  const getFilesFromEvent = useCallback(async (event: DropEvent) => {
    selectionFailed.current = false;
    try {
      return await collectUploadFiles(event);
    } catch (_error) {
      selectionFailed.current = true;
      setSelectionError(
        'Could not read the selected files or folder. Check that they are available on your device, then select them again.'
      );
      return [];
    }
  }, []);

  const getDropZoneComponent = (): ReactElement => {
    return (
      <Dropzone
        getFilesFromEvent={getFilesFromEvent}
        onDrop={acceptedFiles => {
          onDrop(acceptedFiles);
        }}
        noClick
      >
        {({ getRootProps }) => (
          <div
            {...getRootProps()}
            data-cy="dicom-upload-dropzone"
            className="m-5 flex h-full flex-col items-center justify-center rounded-2xl border"
            style={{ borderColor: 'hsl(var(--muted-foreground) / 0.25)' }}
          >
            <div className="flex gap-2">
              <Dropzone
                onDrop={onDrop}
                getFilesFromEvent={getFilesFromEvent}
                noDrag
              >
                {({ getRootProps, getInputProps }) => (
                  <div {...getRootProps()}>
                    <Button
                      variant="default"
                      size="lg"
                      disabled={false}
                      onClick={() => {}}
                    >
                      {'Add files'}
                      <input
                        {...getInputProps()}
                        data-cy="dicom-upload-files"
                        style={{ display: 'none' }}
                      />
                    </Button>
                  </div>
                )}
              </Dropzone>
              <Dropzone
                onDrop={onDrop}
                getFilesFromEvent={getFilesFromEvent}
                noDrag
              >
                {({ getRootProps, getInputProps }) => (
                  <div {...getRootProps()}>
                    <Button
                      variant="secondary"
                      size="lg"
                      disabled={false}
                      onClick={() => {}}
                    >
                      {'Add folder'}
                      <input
                        {...getInputProps()}
                        {...directoryAttributes}
                        data-cy="dicom-upload-folder"
                        style={{ display: 'none' }}
                      />
                    </Button>
                  </div>
                )}
              </Dropzone>
            </div>
            <div className="text-foreground pt-6 text-base">
              or drag DICOM files or folders here
            </div>
            <div className="text-muted-foreground px-4 pt-2 text-center text-sm">
              DICOM files only, including files without a filename extension. NIfTI and other image
              formats are not supported here. Extract ZIP archives before selecting a folder.
            </div>
            <div className="text-muted-foreground px-4 pt-2 text-center text-sm">
              Supported files will upload; other files will be skipped with an explanation.
            </div>
          </div>
        )}
      </Dropzone>
    );
  };

  return (
    <>
      {selectionError && (
        <p
          role="alert"
          data-cy="dicom-upload-selection-error"
          className="p-3 text-sm"
        >
          {selectionError}
        </p>
      )}
      {dicomFileUploaderArr.length ? (
        <div className={classNames('h-[calc(100vh-300px)]', baseClassNames)}>
          <DicomUploadProgress
            dicomFileUploaderArr={dicomFileUploaderArr}
            onComplete={onComplete}
          />
        </div>
      ) : (
        <div className={classNames('h-[480px]', baseClassNames)}>{getDropZoneComponent()}</div>
      )}
    </>
  );
}

DicomUpload.propTypes = {
  dataSource: PropTypes.object.isRequired,
  onComplete: PropTypes.func.isRequired,
  onStarted: PropTypes.func.isRequired,
};

export default DicomUpload;
