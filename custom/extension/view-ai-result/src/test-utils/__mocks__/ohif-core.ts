// Only the symbols view-ai-result imports from @ohif/core.
export const utils = {
  formatDate: (d?: string) => d || '',
};

export const useSystem = () =>
  (globalThis as any).__OHIF_SYSTEM__ ?? {
    servicesManager: { services: {} },
    commandsManager: { runCommand: jest.fn() },
    extensionManager: { getModuleEntry: jest.fn() },
  };

// Study-level DICOM tags (StudyDate/StudyDescription) are frequently absent from
// display sets and have to be read from here instead. Backed by a per-test map so
// a test can populate a study without standing up the real store.
export const DicomMetadataStore = {
  getStudy: (studyUID: string) => (globalThis as any).__OHIF_STUDIES__?.[studyUID],
};
