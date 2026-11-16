import type { DropEvent } from 'react-dropzone';
import type { UploadFile } from './DicomFileUploader';

/** Keep auxiliary files in the selection so the report can explain why they were skipped. */
export async function collectUploadFiles(
  event: DropEvent
): Promise<(UploadFile | DataTransferItem)[]> {
  if (!('dataTransfer' in event) || !event.dataTransfer) {
    return Array.from((event.target as HTMLInputElement)?.files || []);
  }
  const { dataTransfer } = event;
  if (!dataTransfer.items?.length) {
    return Array.from(dataTransfer.files);
  }
  const items = Array.from(dataTransfer.items).filter(item => item.kind === 'file');
  // Browsers do not expose file contents until the drop event.
  if (event.type !== 'drop') {
    return items;
  }

  // Capture every handle during drop dispatch. After the first awaited read, the
  // browser protects the drag data and later items can no longer be accessed.
  const sources = items.map(item => {
    const entry = item.webkitGetAsEntry?.();
    return { entry, file: entry ? null : item.getAsFile() };
  });

  const files: UploadFile[] = [];
  const visit = async (entry: FileSystemEntry): Promise<void> => {
    if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries can return only part of the directory (e.g. 100 entries in Chromium).
      while (true) {
        const entries = await new Promise<FileSystemEntry[]>((resolve, reject) =>
          reader.readEntries(resolve, reject)
        );
        if (!entries.length) {
          return;
        }
        for (const child of entries) {
          await visit(child);
        }
      }
    }
    const file = await new Promise<File>((resolve, reject) =>
      (entry as FileSystemFileEntry).file(resolve, reject)
    );
    Object.defineProperty(file, 'path', { value: entry.fullPath, configurable: true });
    files.push(file);
  };

  for (const { entry, file } of sources) {
    if (entry) {
      await visit(entry);
    } else {
      if (!file) {
        throw new Error('Could not read the selected file.');
      }
      files.push(file);
    }
  }
  return files;
}
