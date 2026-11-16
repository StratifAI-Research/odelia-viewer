import { validateUploadFile, readUploadBlob } from './dicomUploadValidation';
import { dicomBytes, dicomFile } from './testUtils/dicomUploadFixtures';

const validate = async (file: File) =>
  validateUploadFile(file, await readUploadBlob(file, new AbortController().signal));

describe('upload file recognition', () => {
  it.each(['image', 'image.dcm', 'image.nii.gz', 'image.JPG'])(
    'accepts DICOM content regardless of filename: %s',
    async name => {
      expect(await validate(dicomFile(name))).toBeUndefined();
    }
  );

  it('recognizes DICOMDIR by its SOP class, even under a different name', async () => {
    expect(await validate(dicomFile('index', '1.2.840.10008.1.3.10'))).toMatchObject({
      code: 'dicom-directory',
      disposition: 'skipped',
    });
    expect(await validate(dicomFile('DICOMDIR'))).toBeUndefined();
  });

  it.each([
    ['brain.nii', 'unsupported-nifti'],
    ['brain.NII.GZ', 'unsupported-nifti'],
    ['brain.nrrd', 'unsupported-nrrd'],
    ['brain.mha', 'unsupported-metaimage'],
    ['scan.png', 'unsupported-png'],
    ['scan.jpeg', 'unsupported-jpeg'],
    ['report.pdf', 'unsupported-pdf'],
    ['export.zip', 'archive'],
    ['.DS_Store', 'auxiliary-file'],
    ['Thumbs.db', 'auxiliary-file'],
    ['._image.dcm', 'auxiliary-file'],
    ['fake.dcm', 'unrecognized-file'],
  ])('explains unsupported file %s', async (name, code) => {
    expect(await validate(new File(['not DICOM'], name))).toMatchObject({
      code,
      disposition: 'skipped',
    });
  });

  it.each([
    [new Uint8Array([0x50, 0x4b, 3, 4]), 'archive'],
    [new Uint8Array([0x89, 80, 78, 71, 13, 10, 26, 10]), 'unsupported-png'],
    [new Uint8Array([255, 216, 255]), 'unsupported-jpeg'],
    ['NRRD0005', 'unsupported-nrrd'],
    ['%PDF-1.7', 'unsupported-pdf'],
  ])('recognizes content without a matching extension', async (content, code) => {
    expect(await validate(new File([content], 'unknown.dcm'))).toMatchObject({ code });
  });

  it('recognizes NIfTI magic without relying on the extension', async () => {
    const bytes = new Uint8Array(352);
    new DataView(bytes.buffer).setInt32(0, 348, true);
    bytes.set([110, 43, 49, 0], 344);
    expect(await validate(new File([bytes], 'volume'))).toMatchObject({
      code: 'unsupported-nifti',
    });
  });

  it('rejects empty and truncated files without claiming they are corrupt DICOM', async () => {
    expect(await validate(new File([], 'empty.dcm'))).toMatchObject({
      code: 'empty-file',
      disposition: 'failed',
    });
    expect(await validate(new File([dicomBytes().slice(0, 130)], 'truncated.dcm'))).toMatchObject({
      code: 'unrecognized-file',
    });
  });

  it('aborts local reads', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(readUploadBlob(dicomFile(), controller.signal)).rejects.toMatchObject({
      name: 'AbortError',
    });
  });
});
