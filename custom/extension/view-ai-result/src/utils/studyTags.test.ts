import { resolveStudyTags } from './studyTags';

/** Populate the DicomMetadataStore mock (see test-utils/__mocks__/ohif-core.ts). */
function setStore(studies: Record<string, any>) {
  (globalThis as any).__OHIF_STUDIES__ = studies;
}

afterEach(() => {
  delete (globalThis as any).__OHIF_STUDIES__;
});

describe('resolveStudyTags', () => {
  it('prefers tags carried directly on the display sets', () => {
    const tags = resolveStudyTags('study-1', [
      { StudyDate: '20260812', StudyDescription: 'Breast MRI' },
    ]);
    expect(tags).toEqual({ StudyDate: '20260812', StudyDescription: 'Breast MRI' });
  });

  it('combines tags scattered across several display sets', () => {
    // Neither display set is fully populated on its own.
    const tags = resolveStudyTags('study-1', [
      { StudyDate: '20260812' },
      { StudyDescription: 'Breast MRI' },
    ]);
    expect(tags).toEqual({ StudyDate: '20260812', StudyDescription: 'Breast MRI' });
  });

  it('falls back to the first instance a display set carries', () => {
    const tags = resolveStudyTags('study-1', [
      { instances: [{ StudyDate: '20260812', StudyDescription: 'Breast MRI' }] },
    ]);
    expect(tags).toEqual({ StudyDate: '20260812', StudyDescription: 'Breast MRI' });
  });

  it('accepts the singular `instance` shape too', () => {
    const tags = resolveStudyTags('study-1', [
      { instance: { StudyDate: '20260812', StudyDescription: 'Breast MRI' } },
    ]);
    expect(tags).toEqual({ StudyDate: '20260812', StudyDescription: 'Breast MRI' });
  });

  it('falls back to the metadata store when display sets carry nothing', () => {
    // This is the real-world case that made the panel show a bare UID tail: a
    // DICOMweb study whose display sets have neither tag.
    setStore({
      'study-1': {
        series: [
          {
            Modality: 'MR',
            instances: [{ StudyDate: '20260812', StudyDescription: 'Breast MRI' }],
          },
        ],
      },
    });
    const tags = resolveStudyTags('study-1', [{ SeriesInstanceUID: 'se-1' }]);
    expect(tags).toEqual({ StudyDate: '20260812', StudyDescription: 'Breast MRI' });
  });

  it('reads study-level tags off the stored study when it has no series', () => {
    setStore({ 'study-1': { StudyDate: '20260812', StudyDescription: 'Breast MRI' } });
    expect(resolveStudyTags('study-1')).toEqual({
      StudyDate: '20260812',
      StudyDescription: 'Breast MRI',
    });
  });

  it('does not inherit the study aggregate when it was polluted by a derived series', () => {
    // Reproduces the real UKA_1 study as it looked before the router was fixed:
    // the only imaging series carries no study description, while the heatmap
    // builder stamped `StudyDescription = "AI Attention Heatmap Visualization"`
    // onto the SC it wrote (orthanc/router/server.py). OHIF aggregates that to
    // study level, so trusting the aggregate would label the patient's MRI with
    // the name of an AI artefact. Correct answer here is "nothing known".
    // The router no longer writes it, but archives still hold objects that do.
    setStore({
      'study-1': {
        StudyDescription: 'AI Attention Heatmap Visualization',
        StudyDate: '',
        series: [
          { Modality: 'MR', instances: [{ SeriesDescription: 'NCI-dyn DEV' }] },
          {
            Modality: 'SC',
            instances: [{ StudyDescription: 'AI Attention Heatmap Visualization' }],
          },
          { Modality: 'SR', instances: [{ StudyDescription: 'AI Classification Report' }] },
        ],
      },
    });
    expect(resolveStudyTags('study-1')).toEqual({
      StudyDate: undefined,
      StudyDescription: undefined,
    });
  });

  it('still reads a genuine description from the imaging series alongside derived ones', () => {
    setStore({
      'study-1': {
        StudyDescription: 'AI Attention Heatmap Visualization',
        series: [
          {
            Modality: 'SC',
            instances: [{ StudyDescription: 'AI Attention Heatmap Visualization' }],
          },
          {
            Modality: 'MR',
            instances: [{ StudyDate: '20260812', StudyDescription: 'Breast MRI' }],
          },
        ],
      },
    });
    expect(resolveStudyTags('study-1')).toEqual({
      StudyDate: '20260812',
      StudyDescription: 'Breast MRI',
    });
  });

  it('ignores SR and SC series so an AI report cannot overwrite the description', () => {
    // A derived report carries its own description; using it would mislabel the
    // study the user is actually asking about.
    setStore({
      'study-1': {
        series: [
          { Modality: 'SR', instances: [{ StudyDescription: 'ODELIA AI Report' }] },
          { Modality: 'SC', instances: [{ StudyDescription: 'Heatmap' }] },
          {
            Modality: 'MR',
            instances: [{ StudyDate: '20260812', StudyDescription: 'Breast MRI' }],
          },
        ],
      },
    });
    expect(resolveStudyTags('study-1').StudyDescription).toBe('Breast MRI');
  });

  it('treats blank tags as absent so they cannot mask a later source', () => {
    setStore({
      'study-1': {
        series: [{ Modality: 'MR', instances: [{ StudyDescription: 'Breast MRI' }] }],
      },
    });
    const tags = resolveStudyTags('study-1', [{ StudyDescription: '   ', StudyDate: '' }]);
    expect(tags.StudyDescription).toBe('Breast MRI');
  });

  it('returns what it found when only one tag exists anywhere', () => {
    expect(resolveStudyTags('study-1', [{ StudyDate: '20260812' }])).toEqual({
      StudyDate: '20260812',
      StudyDescription: undefined,
    });
  });

  it('degrades to empty rather than throwing when nothing is known', () => {
    // A render must never blow up because a study is not in the store.
    expect(resolveStudyTags('unknown')).toEqual({
      StudyDate: undefined,
      StudyDescription: undefined,
    });
    expect(resolveStudyTags('unknown', [])).toEqual({
      StudyDate: undefined,
      StudyDescription: undefined,
    });
  });

  it('survives a metadata store that throws', () => {
    (globalThis as any).__OHIF_STUDIES__ = {
      get 'study-1'() {
        throw new Error('store exploded');
      },
    };
    expect(() => resolveStudyTags('study-1')).not.toThrow();
  });

  it('tolerates malformed display-set entries', () => {
    expect(() => resolveStudyTags('study-1', [null, undefined, {}] as any)).not.toThrow();
  });

  describe('AccessionNumber', () => {
    it('resolves it from the same three sources', () => {
      expect(resolveStudyTags('study-1', [{ AccessionNumber: 'UKA_1' }]).AccessionNumber).toBe(
        'UKA_1'
      );
      expect(
        resolveStudyTags('study-1', [{ instances: [{ AccessionNumber: 'UKA_2' }] }]).AccessionNumber
      ).toBe('UKA_2');
      setStore({
        'study-1': { series: [{ Modality: 'MR', instances: [{ AccessionNumber: 'UKA_3' }] }] },
      });
      expect(resolveStudyTags('study-1').AccessionNumber).toBe('UKA_3');
    });

    it('keeps looking for it after date and description are already known', () => {
      // The early return has to be conditional on the accession too, or a display
      // set that happens to carry both other tags would end the search first.
      const tags = resolveStudyTags('study-1', [
        { StudyDate: '20260812', StudyDescription: 'Breast MRI' },
        { AccessionNumber: 'UKA_1' },
      ]);
      expect(tags.AccessionNumber).toBe('UKA_1');
    });

    it('resolves the real UKA study to its accession alone', () => {
      // Exactly what Orthanc holds: one MR series, no study date, no study
      // description, the cohort identifier in AccessionNumber.
      setStore({
        'study-1': {
          series: [
            {
              Modality: 'MR',
              instances: [{ SeriesDescription: 'NCI-dyn DEV', AccessionNumber: 'UKA_1' }],
            },
          ],
        },
      });
      expect(resolveStudyTags('study-1')).toEqual({
        StudyDate: undefined,
        StudyDescription: undefined,
        AccessionNumber: 'UKA_1',
      });
    });

    it('treats a blank accession as absent', () => {
      setStore({
        'study-1': { series: [{ Modality: 'MR', instances: [{ AccessionNumber: 'UKA_1' }] }] },
      });
      expect(resolveStudyTags('study-1', [{ AccessionNumber: '   ' }]).AccessionNumber).toBe(
        'UKA_1'
      );
    });

    it('ignores SR and SC series here too', () => {
      // Derived objects share the study UID, so anything study-level on them is
      // the study's or nothing — never the derived object's own.
      setStore({
        'study-1': {
          series: [
            { Modality: 'SR', instances: [{ AccessionNumber: 'AI_REPORT' }] },
            { Modality: 'MR', instances: [{ AccessionNumber: 'UKA_1' }] },
          ],
        },
      });
      expect(resolveStudyTags('study-1').AccessionNumber).toBe('UKA_1');
    });
  });
});
