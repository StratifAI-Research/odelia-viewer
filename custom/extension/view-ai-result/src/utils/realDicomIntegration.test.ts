/**
 * ODV-223 verification against REAL DICOM binary.
 *
 * Rather than hand-built fixtures, this test writes actual DICOM Part-10 files
 * with dcmjs (the same library OHIF parses with), matching the tag layout the
 * real ODELIA AI-routing pipeline emits (orthanc-routing-example/orthanc-router
 * server.py: SR via create_bilateral_sr, SC via create_text_overlay_sc — the SC
 * carries its own SOP Instance UID, references the SR through
 * ReferencedInstanceSequence, and shares the SR's creation timestamps). The
 * files are then read back through the exact OHIF pipeline
 * (DicomMessage.readFile → naturalizeDataset) and fed to the production grouping
 * code, proving the SR SOP Instance UID is really readable and used as identity.
 */
import fs from 'fs';
import os from 'os';
import path from 'path';
import { TextEncoder, TextDecoder } from 'util';
import { data } from 'dcmjs';

import { primarySopInstanceUID, findMatchingSRForHeatmap } from './aiResultPairing';
import { resolveAIGroupIdentity } from './aiTabHelpers';
import { formatDicomDateTime } from './dicomDateTime';
import { createAIBrowserTabs, clearDisplaySetCache } from './createAIBrowserTabs';
import {
  createStudyAIBrowserTabsNested,
  clearNestedTabCache,
} from './createStudyAIBrowserTabsNested';

// dcmjs needs TextEncoder/TextDecoder at call time, which the jsdom test env does
// not provide. (dcmjs itself uses them only when reading/writing, not on import.)
if (typeof (global as any).TextEncoder === 'undefined') {
  (global as any).TextEncoder = TextEncoder;
}
if (typeof (global as any).TextDecoder === 'undefined') {
  (global as any).TextDecoder = TextDecoder;
}

const { DicomMessage, DicomMetaDictionary, DicomDict } = data as any;

const EXPLICIT_VR_LE = '1.2.840.10008.1.2.1';
const COMPREHENSIVE_SR = '1.2.840.10008.5.1.4.1.1.88.34';
const SECONDARY_CAPTURE = '1.2.840.10008.5.1.4.1.1.7';
const STUDY = '1.2.826.0.1.3680043.8.498.999';

// Silence dcmjs's cosmetic VR logging during (de)serialization. Assertions still
// throw on real failures, so this only removes noise, never hides errors.
let logSpy: jest.SpyInstance, warnSpy: jest.SpyInstance, errSpy: jest.SpyInstance;
beforeEach(() => {
  clearDisplaySetCache();
  clearNestedTabCache();
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  warnSpy.mockRestore();
  errSpy.mockRestore();
});

/** Write a naturalized dataset to real DICOM Part-10 bytes. */
function writeDicom(natural: any): Buffer {
  const dict = new DicomDict({
    TransferSyntaxUID: EXPLICIT_VR_LE,
    MediaStorageSOPClassUID: natural.SOPClassUID,
    MediaStorageSOPInstanceUID: natural.SOPInstanceUID,
    ImplementationClassUID: '1.2.3.4',
  });
  dict.dict = DicomMetaDictionary.denaturalizeDataset(natural);
  return Buffer.from(dict.write());
}

/** Parse real DICOM bytes exactly as OHIF does: read + naturalize. */
function parseDicom(buf: Buffer): any {
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  return DicomMetaDictionary.naturalizeDataset(DicomMessage.readFile(ab).dict);
}

/** Build an OHIF-shaped display set (thumbnail === real, no service needed). */
function makeDisplaySet(instance: any, displaySetInstanceUID: string): any {
  return {
    Modality: instance.Modality,
    StudyInstanceUID: instance.StudyInstanceUID,
    SeriesInstanceUID: instance.SeriesInstanceUID,
    displaySetInstanceUID,
    numInstances: 1,
    instance,
  };
}

/** A realistic ODELIA SR: model + one classification in the ContentSequence. */
function srDataset(sopUid: string, model: string, time = '101010'): any {
  return {
    SOPClassUID: COMPREHENSIVE_SR,
    SOPInstanceUID: sopUid,
    StudyInstanceUID: STUDY,
    SeriesInstanceUID: `1.2.826.0.1.3680043.8.498.${sopUid.slice(-4)}1`,
    Modality: 'SR',
    InstanceCreationDate: '20240315',
    InstanceCreationTime: time,
    SeriesDescription: `${model} - Structured Report`,
    ContentSequence: [
      {
        ValueType: 'CONTAINER',
        ConceptNameCodeSequence: [
          { CodeValue: '126000', CodingSchemeDesignator: 'DCM', CodeMeaning: 'Imaging Report' },
        ],
        ContinuityOfContent: 'SEPARATE',
        ContentSequence: [
          {
            ValueType: 'TEXT',
            ConceptNameCodeSequence: [
              { CodeValue: '12710003', CodingSchemeDesignator: 'SCT', CodeMeaning: 'AI Model' },
            ],
            TextValue: model,
          },
          {
            ValueType: 'CODE',
            ConceptNameCodeSequence: [
              {
                CodeValue: 'L1',
                CodingSchemeDesignator: 'SCT',
                CodeMeaning: 'Left Side Probability',
              },
            ],
            ConceptCodeSequence: [
              { CodeValue: 'M1', CodingSchemeDesignator: 'SCT', CodeMeaning: 'Malignant' },
            ],
          },
        ],
      },
    ],
  };
}

/** A realistic ODELIA heatmap SC referencing its SR, sharing the SR's timestamps. */
function scDataset(sopUid: string, srSopUid: string, model: string, time = '101010'): any {
  return {
    SOPClassUID: SECONDARY_CAPTURE,
    SOPInstanceUID: sopUid,
    StudyInstanceUID: STUDY,
    SeriesInstanceUID: `1.2.826.0.1.3680043.8.498.${sopUid.slice(-4)}2`,
    Modality: 'SC',
    InstanceCreationDate: '20240315',
    InstanceCreationTime: time,
    SeriesDescription: `${model} - Heatmap`,
    ReferencedInstanceSequence: [
      { ReferencedSOPClassUID: COMPREHENSIVE_SR, ReferencedSOPInstanceUID: srSopUid },
    ],
  };
}

const SR_A = '1.2.826.0.1.3680043.8.498.1001';
const SC_A = '1.2.826.0.1.3680043.8.498.2002';

/** Round-trip a dataset through real DICOM bytes and OHIF's parser. */
function roundTrip(natural: any): any {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'odv223-'));
  const file = path.join(dir, `${natural.SOPInstanceUID}.dcm`);
  fs.writeFileSync(file, writeDicom(natural));
  const parsed = parseDicom(fs.readFileSync(file));
  fs.rmSync(dir, { recursive: true, force: true });
  return parsed;
}

describe('ODV-223 — real DICOM round-trip', () => {
  it('reads the SR SOP Instance UID after a real DICOM write→read→naturalize', () => {
    const srInstance = roundTrip(srDataset(SR_A, 'MST-BreastNet'));
    expect(srInstance.Modality).toBe('SR');
    // The value survives real serialization and lands where the code reads it.
    expect(srInstance.SOPInstanceUID).toBe(SR_A);
    const ds = makeDisplaySet(srInstance, 'ds-sr-a');
    expect(primarySopInstanceUID(ds)).toBe(SR_A);
  });

  it('pairs a real heatmap (SC) to its report (SR) by the referenced SOP UID', () => {
    const srInstance = roundTrip(srDataset(SR_A, 'MST-BreastNet'));
    const scInstance = roundTrip(scDataset(SC_A, SR_A, 'MST-BreastNet'));
    // The SC really carries the SR's UID in ReferencedInstanceSequence.
    expect(scInstance.ReferencedInstanceSequence[0].ReferencedSOPInstanceUID).toBe(SR_A);

    const srDs = makeDisplaySet(srInstance, 'ds-sr-a');
    const scDs = makeDisplaySet(scInstance, 'ds-sc-a');

    // Pairing resolves the SC back to the SR, and identity is the SR's SOP UID.
    expect(findMatchingSRForHeatmap(scDs, [srDs])).toBe(srDs);
    expect(resolveAIGroupIdentity(scDs, [srDs]).key).toBe(SR_A);
    expect(resolveAIGroupIdentity(srDs, [srDs]).key).toBe(SR_A);
  });

  it('groups a real SR + its heatmap into one tab keyed by the SR SOP UID', () => {
    const srDs = makeDisplaySet(roundTrip(srDataset(SR_A, 'MST-BreastNet')), 'ds-sr-a');
    const scDs = makeDisplaySet(roundTrip(scDataset(SC_A, SR_A, 'MST-BreastNet')), 'ds-sc-a');

    const flat = createAIBrowserTabs([STUDY], [], [srDs, scDs]);
    const flatAi = flat.filter(t => t.name.startsWith('ai-'));
    expect(flatAi).toHaveLength(1);
    expect(
      flatAi[0].studies[0].displaySets.map((d: any) => d.displaySetInstanceUID).sort()
    ).toEqual(['ds-sc-a', 'ds-sr-a']);

    const nested = createStudyAIBrowserTabsNested([STUDY], [], [srDs, scDs]);
    const groups = nested[0].studies[0].aiGroups;
    expect(groups).toHaveLength(1);
    expect(groups[0].key).toBe(SR_A);
    expect(groups[0].displaySets.map((d: any) => d.displaySetInstanceUID).sort()).toEqual([
      'ds-sc-a',
      'ds-sr-a',
    ]);
  });

  it('keeps two real reports (same model, same second, different SOP UID) in separate groups', () => {
    const srOne = makeDisplaySet(
      roundTrip(srDataset('1.2.826.0.1.3680043.8.498.3003', 'MST-BreastNet')),
      'ds-sr-1'
    );
    const srTwo = makeDisplaySet(
      roundTrip(srDataset('1.2.826.0.1.3680043.8.498.4004', 'MST-BreastNet')),
      'ds-sr-2'
    );
    const flatAi = createAIBrowserTabs([STUDY], [], [srOne, srTwo]).filter(t =>
      t.name.startsWith('ai-')
    );
    expect(flatAi).toHaveLength(2);
  });

  it('formats the real SR creation date/time under the labeled-timezone policy', () => {
    const srInstance = roundTrip(srDataset(SR_A, 'MST-BreastNet'));
    // No DICOM offset stamped → labeled "(timezone unknown)", never assumed UTC.
    expect(
      formatDicomDateTime(srInstance.InstanceCreationDate, srInstance.InstanceCreationTime)
    ).toBe('2024-03-15 10:10:10 (timezone unknown)');
  });

  it('reads the SOP Instance UID from a genuine ODELIA sample sc.dcm (when ODV_SAMPLE_DIR is set)', () => {
    // Point ODV_SAMPLE_DIR at Luab/orthanc-routing-example/sample_data to run
    // this against the real ODELIA-produced heatmap. Skips otherwise (CI).
    const sampleDir = process.env.ODV_SAMPLE_DIR;
    const sample = sampleDir ? path.join(sampleDir, 'sc.dcm') : '';
    if (!sample || !fs.existsSync(sample)) {
      return;
    }
    const instance = parseDicom(fs.readFileSync(sample));
    const ds = makeDisplaySet(instance, 'ds-real-sc');
    expect(instance.Modality).toBe('SC');
    expect(primarySopInstanceUID(ds)).toBe(instance.SOPInstanceUID);
    expect(primarySopInstanceUID(ds)!.length).toBeGreaterThan(0);
  });
});
