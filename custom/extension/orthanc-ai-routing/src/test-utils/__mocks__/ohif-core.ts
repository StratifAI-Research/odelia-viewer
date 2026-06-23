// Jest stub for @ohif/core (its built dist isn't present under CI's frozen install,
// so a jest.mock factory can't even resolve the path). Mapped via moduleNameMapper.
// Only the symbols the extension imports are provided.
export const utils = { formatDate: (d: string) => d || '' };
export const DicomMetadataStore = { getStudy: jest.fn(() => ({ series: [] as any[] })) };
