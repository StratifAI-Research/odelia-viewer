/**
 * End-to-end guard for the defect fixed in 6aca73e94c.
 *
 * sopClassHandlers.test.ts asserts only that two handler-id strings appear in the mode's
 * `sopClassHandlers`, and its own comment admits it does not exercise the behaviour. This drives
 * the REAL DisplaySetService over the mode's REAL declared handler list, so it fails if the SR
 * ever resolves back to the unsupported fallback -- by any route, not just a missing id.
 *
 * The chain it guards: an SR with no SR handler falls to getDisplaySetsFromUnsupportedSeries,
 * which wraps it in an ImageSet whose `.images` is truthy, so DicomWebDataSource mints a
 * `/frames/1` wadors imageId for an object with no pixel data; the prefetcher requests it,
 * Orthanc answers 400, and the bare XMLHttpRequest rejection surfaces as a blank "Something went
 * wrong" dialog. That same fallback sets `instance: instances[instance.length - 1]` -- `instance`
 * is an object, so the index is NaN and the result undefined -- losing the ContentSequence that
 * carries the AI classifications.
 *
 * Both halves are asserted on the OUTPUT of the real service, rather than by pinning upstream's
 * fallback behaviour as a contract this fork depends on.
 */

// The SR handler destructures a few members from these at module scope, and the default handler
// needs i18n for a label. Stubbed virtually to keep those packages out of this mode's jest
// environment. This does NOT cover the SR handler's load()/hydration path, which uses the adapter
// code more deeply; this suite is about display-set construction and routing.
jest.mock('@ohif/i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }), {
  virtual: true,
});
jest.mock(
  '@ohif/extension-cornerstone',
  () => ({
    Enums: {
      CORNERSTONE_3D_TOOLS_SOURCE_NAME: 'Cornerstone3DTools',
      CORNERSTONE_3D_TOOLS_SOURCE_VERSION: '0.1',
    },
  }),
  { virtual: true }
);
jest.mock(
  '@cornerstonejs/adapters',
  () => ({
    adaptersSR: {
      Cornerstone3D: {
        TEXT_ANNOTATION_POSITION: 'TEXT_ANNOTATION_POSITION',
        COMMENT_CODE: { schemeDesignator: 'DCM', value: '121106' },
        CodeScheme: { schemeDesignator: 'CORNERSTONEJS', codeValues: {} },
      },
    },
  }),
  { virtual: true }
);
// registerModeToolbar reaches into a live customizationService; only static wiring is read here.
jest.mock('@ohif/mode-basic', () => ({ registerModeToolbar: jest.fn() }), { virtual: true });

import { DisplaySetService } from '@ohif/core';
import getSRSopClassHandlerModule from '../../../../extensions/cornerstone-dicom-sr/src/getSopClassHandlerModule';
import { SOPClassHandlerId3D } from '../../../../extensions/cornerstone-dicom-sr/src/id';
import getDefaultSopClassHandlerModule from '../../../../extensions/default/src/getSopClassHandlerModule';
import { extractAIResultData } from '../../../extension/view-ai-result/src/utils/extractAIResultData';
import mode from './index';

const COMPREHENSIVE_3D_SR = '1.2.840.10008.5.1.4.1.1.88.34';
const SERIES_UID_BASE = '1.2.826.0.1.3680043.8.498.3372112809666608652169850827051801071';

// DisplaySetService keeps a MODULE-LEVEL displaySetCache keyed by display-set UID, and
// getDisplaySetsForSeries reads through it, so a second service instance still sees the first
// case's display sets. Each case therefore uses its own SeriesInstanceUID rather than relying on
// isolation the service does not provide.
let seriesCounter = 0;
const nextSeriesUid = () => `${SERIES_UID_BASE}${(seriesCounter += 1)}`;

/** A content item shaped the way the real ODELIA report writes one. */
const sideProbability = (side: string, finding: string, percent: string) => ({
  ValueType: 'NUM',
  ConceptNameCodeSequence: [
    { CodeMeaning: `${side} Breast Side Probability`, CodeValue: '111001' },
  ],
  ConceptCodeSequence: [{ CodeMeaning: finding }],
  MeasuredValueSequence: [{ NumericValue: percent }],
});

/**
 * An SR shaped like the ODELIA AI report: one instance, no Rows/Columns/pixel data, and a
 * CONTAINER whose ContentSequence carries the per-side classifications the AI panel renders.
 */
const srInstance = (seriesInstanceUID: string) => ({
  SOPClassUID: COMPREHENSIVE_3D_SR,
  SOPInstanceUID: '1.2.826.0.1.3680043.8.498.89027320469874744925218955415804268703',
  SeriesInstanceUID: seriesInstanceUID,
  StudyInstanceUID: '1.3.46.670589.16.2.2.10.75.20.10.20100804.123124.5106477',
  Modality: 'SR',
  SeriesDescription: 'Automated Diagnostic Findings',
  SeriesDate: '20260617',
  SeriesTime: '200353',
  ConceptNameCodeSequence: { CodeValue: '126000', CodingSchemeDesignator: 'DCM' },
  ContentSequence: [
    {
      ValueType: 'CONTAINER',
      ConceptNameCodeSequence: [{ CodeMeaning: 'Imaging Measurement Report' }],
      ContentSequence: [
        sideProbability('Left', 'Clinical finding absent', '79.4'),
        sideProbability('Right', 'Clinical finding absent', '78.9'),
      ],
    },
  ],
});

/**
 * A DisplaySetService wired to the REAL handler modules, keyed exactly as ExtensionManager keys
 * them: `${extensionId}.${moduleType}.${entry.name}` (ExtensionManager.ts:523). The service
 * resolves a mode's declared id straight through getModuleEntry, so building the map this way is
 * what makes the mode's own list the thing under test.
 */
const serviceForHandlers = (sopClassHandlers: string[]) => {
  const args = { servicesManager: { services: {} }, extensionManager: {} } as never;
  const modules = {
    '@ohif/extension-cornerstone-dicom-sr': getSRSopClassHandlerModule(args),
    '@ohif/extension-default': getDefaultSopClassHandlerModule(args),
  };

  const moduleMap: Record<string, unknown> = {};
  for (const [extensionId, entries] of Object.entries(modules)) {
    for (const entry of entries as Array<{ name: string }>) {
      moduleMap[`${extensionId}.sopClassHandlerModule.${entry.name}`] = entry;
    }
  }

  const displaySetService = new DisplaySetService();
  displaySetService.init({ getModuleEntry: (id: string) => moduleMap[id] }, sopClassHandlers);

  return displaySetService;
};

const srDisplaySetFrom = (sopClassHandlers: string[]) => {
  const seriesInstanceUID = nextSeriesUid();
  const displaySetService = serviceForHandlers(sopClassHandlers);
  displaySetService.makeDisplaySets([srInstance(seriesInstanceUID)]);

  return displaySetService.getDisplaySetsForSeries(seriesInstanceUID)[0] as Record<
    string,
    unknown
  >;
};

describe("the AI report resolves through the mode's own handler list", () => {
  const declared = () => mode.modeFactory().sopClassHandlers as string[];

  it('is handled by the SR handler, not the unsupported fallback', () => {
    const displaySet = srDisplaySetFrom(declared());

    expect(displaySet.SOPClassHandlerId).toBe(SOPClassHandlerId3D);
    expect(displaySet.unsupported).toBeFalsy();
  });

  // No `.images` is precisely what stops DicomWebDataSource minting the `/frames/N` imageId that
  // Orthanc answered 400 to.
  it('carries no pixel image data for a report that has none', () => {
    const displaySet = srDisplaySetFrom(declared());

    expect(displaySet.images).toBeUndefined();
    expect(displaySet.numImageFrames).toBeUndefined();
  });

  it('keeps the instance, so the AI classifications survive', () => {
    const displaySet = srDisplaySetFrom(declared());

    expect(displaySet.instance).toBeDefined();

    // The end the reader sees: the panel's "No lesion (79.4%)" comes from this display set. The
    // fallback lost `.instance`, so extractAIResultData's `instance?.ContentSequence` guard
    // returned null and the AI results silently vanished.
    const aiResult = extractAIResultData(displaySet);

    expect(aiResult?.classifications).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ side: 'Left', confidence: 79.4 }),
        expect.objectContaining({ side: 'Right', confidence: 78.9 }),
      ])
    );
  });

  // The regression this suite exists for, stated as its own case: with the SR ids gone from the
  // mode -- by deletion, rename, or a reordering that leaves nothing to claim the SR -- the
  // service falls back and all three assertions above break. Asserting it here means the guard is
  // verified rather than assumed.
  it('would fall back to a pixel-bearing display set without the SR handlers', () => {
    const withoutSR = declared().filter(id => !id.includes('cornerstone-dicom-sr'));

    const displaySet = srDisplaySetFrom(withoutSR);

    expect(displaySet.SOPClassHandlerId).not.toBe(SOPClassHandlerId3D);
    expect((displaySet.images as unknown[])?.length).toBe(1);
    expect(extractAIResultData(displaySet)).toBeNull();
  });
});
