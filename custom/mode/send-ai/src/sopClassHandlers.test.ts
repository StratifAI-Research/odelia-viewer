// `registerModeToolbar` reaches into a live customizationService; the mode factory is
// only inspected for its static wiring here, so stub it out.
jest.mock('@ohif/mode-basic', () => ({ registerModeToolbar: jest.fn() }), { virtual: true });

import mode from './index';

const STACK = '@ohif/extension-default.sopClassHandlerModule.stack';
const SR_2D = '@ohif/extension-cornerstone-dicom-sr.sopClassHandlerModule.dicom-sr';
const SR_3D = '@ohif/extension-cornerstone-dicom-sr.sopClassHandlerModule.dicom-sr-3d';

describe('send-ai SOP class handlers', () => {
  const sopClassHandlers = mode.modeFactory().sopClassHandlers as string[];

  // Regression: with only the stack handler, the stack handler declines an SR (it skips a
  // non-image instance with no Rows) and DisplaySetService falls back to
  // getDisplaySetsFromUnsupportedSeries, which wraps the SR in an ImageSet. That gives it a
  // truthy `.images`, so DicomWebDataSource mints a `/frames/1` imageId for an object with
  // no pixel data; the prefetcher requests it and Orthanc returns 400. The rejection is a
  // bare XMLHttpRequest, which has neither `message` nor `stack`, so ErrorBoundary shows an
  // empty "Something went wrong" dialog. The same fallback also clobbers `.instance`, which
  // extractAIResultData() needs for `ContentSequence`.
  it('registers the SR handlers so AI report series are not treated as pixel data', () => {
    expect(sopClassHandlers).toContain(SR_2D);
    expect(sopClassHandlers).toContain(SR_3D);
  });

  it('keeps 3D SR ahead of 2D SR, and mirrors mode-basic by leaving the stack handler first', () => {
    expect(sopClassHandlers.indexOf(SR_3D)).toBeLessThan(sopClassHandlers.indexOf(SR_2D));
    expect(sopClassHandlers.indexOf(STACK)).toBeLessThan(sopClassHandlers.indexOf(SR_3D));
  });

  // Mode.tsx does `loadModules(Object.keys(extensions))` on entry, so this declaration is
  // what actually registers the extension — the SR handler ids above resolve to nothing
  // without it, and the extension is `default: false` in pluginConfig.json.
  it('declares the SR extension it takes the handlers from', () => {
    expect(mode.extensionDependencies).toHaveProperty('@ohif/extension-cornerstone-dicom-sr');
  });

  it('still handles ordinary image series', () => {
    expect(sopClassHandlers).toContain(STACK);
  });
});
