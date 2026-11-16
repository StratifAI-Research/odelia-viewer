import DicomFileUploader from './DicomFileUploader';

/** Bound both file reads and requests. Unsupported files never reach the storage service. */
export function startUploadQueue(uploaders: DicomFileUploader[], concurrency = 3) {
  let stopped = false;
  let next = 0;
  const worker = async () => {
    // Allow an effect cleanup (including React StrictMode replay) before starting work.
    await Promise.resolve();
    while (!stopped && next < uploaders.length) {
      const uploader = uploaders[next++];
      if (uploader.isComplete()) {
        continue;
      }
      try {
        await uploader.load();
      } catch (_error) {
        // Each uploader retains its outcome for the report; continue with the remaining files.
      }
    }
  };
  const done = Promise.all(Array.from({ length: concurrency }, worker));
  return {
    done,
    stop: () => {
      stopped = true;
    },
  };
}
