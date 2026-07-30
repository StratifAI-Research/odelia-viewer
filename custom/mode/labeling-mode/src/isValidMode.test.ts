// `@ohif/core` is not resolvable from this package, so mock it virtually.
jest.mock('@ohif/core', () => ({ DicomMetadataStore: { subscribe: jest.fn() } }), {
  virtual: true,
});
jest.mock('./toolbarButtons', () => ({ __esModule: true, default: [] }));
jest.mock('./studiesList', () => ({ __esModule: true, default: () => [] }));

import mode from './index';

describe('labeling-mode isValidMode', () => {
  const isValidMode = () => mode.modeFactory().isValidMode({ modalities: 'MR' });

  it('returns a { valid } object, not a bare boolean', () => {
    // A bare `true` here destructures to `undefined` in WorkList and renders
    // the mode disabled in the study list.
    expect(isValidMode()).toEqual({ valid: true });
  });

  it('survives the destructuring WorkList actually performs', () => {
    const { valid } = isValidMode();
    expect(valid).toBe(true);
  });

  it('accepts any modality', () => {
    ['MR', 'CT', 'MR\\SR', ''].forEach(modalities => {
      expect(mode.modeFactory().isValidMode({ modalities }).valid).toBe(true);
    });
  });
});
