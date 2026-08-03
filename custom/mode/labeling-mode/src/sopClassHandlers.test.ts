// `registerModeToolbar` reaches into a live customizationService; the mode factory is
// only inspected for its static wiring here, so stub it out.
jest.mock('@ohif/mode-basic', () => ({ registerModeToolbar: jest.fn() }), { virtual: true });

import mode from './index';

const STACK = '@ohif/extension-default.sopClassHandlerModule.stack';
const SR_2D = '@ohif/extension-cornerstone-dicom-sr.sopClassHandlerModule.dicom-sr';
const SR_3D = '@ohif/extension-cornerstone-dicom-sr.sopClassHandlerModule.dicom-sr-3d';

describe('labeling-mode SOP class handlers', () => {
  const factory = mode.modeFactory();
  const sopClassHandlers = factory.sopClassHandlers as string[];

  // Wiring only -- see the send-ai suite for the same note. The behaviour these guard
  // against is the SR falling through to getDisplaySetsFromUnsupportedSeries, which mints
  // a `/frames/1` imageId for an object with no pixel data (Orthanc 400 -> bare
  // XMLHttpRequest rejection -> "Uncaught runtime errors" overlay).
  it('registers the SR handlers so AI report series are not treated as pixel data', () => {
    expect(sopClassHandlers).toContain(SR_2D);
    expect(sopClassHandlers).toContain(SR_3D);
  });

  it('keeps 3D SR ahead of 2D SR, and mirrors mode-basic by leaving the stack handler first', () => {
    expect(sopClassHandlers.indexOf(SR_3D)).toBeLessThan(sopClassHandlers.indexOf(SR_2D));
    expect(sopClassHandlers.indexOf(STACK)).toBeLessThan(sopClassHandlers.indexOf(SR_3D));
  });

  // Mode.tsx does `loadModules(Object.keys(extensions))` on entry, so this declaration is
  // what actually registers the extension -- the SR handler ids above resolve to nothing
  // without it, and the extension is `default: false` in pluginConfig.json.
  it('declares the SR extension it takes the handlers from', () => {
    expect(factory.extensions).toHaveProperty('@ohif/extension-cornerstone-dicom-sr');
  });

  it('still handles ordinary image series', () => {
    expect(sopClassHandlers).toContain(STACK);
  });

  // Registering the handlers must not widen what the hanging protocol will place in a
  // viewport: this mode has no SR viewport, so the SR must stay out of the grid.
  it('does not offer the SR to a viewport', () => {
    const displaySetsToDisplay = factory.routes
      .flatMap(route => route.layoutTemplate?.().props?.viewports ?? [])
      .flatMap(viewport => viewport.displaySetsToDisplay ?? []);

    expect(displaySetsToDisplay).toContain(STACK);
    expect(displaySetsToDisplay).not.toContain(SR_2D);
    expect(displaySetsToDisplay).not.toContain(SR_3D);
  });
});
