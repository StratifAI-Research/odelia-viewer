import type { DropEvent } from 'react-dropzone';
import { collectUploadFiles } from './collectUploadFiles';

const fileEntry = (name: string, path = `/exam/${name}`) => ({
  isDirectory: false,
  fullPath: path,
  file: resolve => resolve(new File(['data'], name)),
});
const directory = (batches: unknown[][]) => ({
  isDirectory: true,
  createReader: () => ({ readEntries: resolve => resolve(batches.shift() || []) }),
});
const drop = (entry: unknown) =>
  ({
    type: 'drop',
    dataTransfer: { items: [{ kind: 'file', webkitGetAsEntry: () => entry }] },
  }) as unknown as DropEvent;

describe('upload selection', () => {
  it('reads every directory batch and preserves nested paths and auxiliary files', async () => {
    const files = await collectUploadFiles(
      drop(
        directory([
          [fileEntry('slice.dcm'), directory([[fileEntry('slice.dcm', '/exam/nested/slice.dcm')]])],
          [fileEntry('.DS_Store'), fileEntry('Thumbs.db')],
        ])
      )
    );
    expect(files.map(file => (file as File).name)).toEqual([
      'slice.dcm',
      'slice.dcm',
      '.DS_Store',
      'Thumbs.db',
    ]);
    expect(files[1]).toMatchObject({ path: '/exam/nested/slice.dcm' });
  });

  it('surfaces directory enumeration failures instead of returning an incomplete selection', async () => {
    const error = new DOMException('Not allowed', 'NotReadableError');
    await expect(
      collectUploadFiles(
        drop({
          isDirectory: true,
          createReader: () => ({ readEntries: (_resolve, reject) => reject(error) }),
        })
      )
    ).rejects.toBe(error);
  });

  it('surfaces unreadable directory entries', async () => {
    await expect(
      collectUploadFiles(
        drop({ isDirectory: false, file: (_resolve, reject) => reject(new Error('unreadable')) })
      )
    ).rejects.toThrow('unreadable');
  });

  it('supports native picker files and empty folders', async () => {
    const file = new File(['data'], 'slice');
    expect(await collectUploadFiles({ target: { files: [file] } } as unknown as DropEvent)).toEqual(
      [file]
    );
    expect(await collectUploadFiles(drop(directory([])))).toEqual([]);
  });

  it('supports drag sources without directory APIs', async () => {
    const file = new File(['data'], 'slice');
    const event = {
      type: 'drop',
      dataTransfer: { items: [{ kind: 'file', getAsFile: () => file }] },
    } as unknown as DropEvent;
    expect(await collectUploadFiles(event)).toEqual([file]);
  });
});
