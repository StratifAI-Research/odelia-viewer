// `registerModeToolbar` reaches into a live customizationService; the mode factory is
// only inspected for its static wiring here, so stub it out.
jest.mock('@ohif/mode-basic', () => ({ registerModeToolbar: jest.fn() }), { virtual: true });

import mode from './index';

const STACK = '@ohif/extension-default.sopClassHandlerModule.stack';
const SR_2D = '@ohif/extension-cornerstone-dicom-sr.sopClassHandlerModule.dicom-sr';
const SR_3D = '@ohif/extension-cornerstone-dicom-sr.sopClassHandlerModule.dicom-sr-3d';

describe('send-ai SOP class handlers', () => {
  const sopClassHandlers = mode.modeFactory().sopClassHandlers as string[];

  // These assertions cover the WIRING only — that the ids and the dependency are declared.
  // They do not exercise the behaviour that motivated the change (an SR resolving to the SR
  // handler, keeping `.instance`, and yielding no image ids); that needs a test which drives
  // the real handler and the DICOMweb data source. See the commit message for the full chain:
  // stack-handler-only => getDisplaySetsFromUnsupportedSeries => truthy `.images` =>
  // a `/frames/1` request for an object with no pixel data => 400 => bare XMLHttpRequest
  // rejection with no message/stack => empty ErrorBoundary dialog.
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
