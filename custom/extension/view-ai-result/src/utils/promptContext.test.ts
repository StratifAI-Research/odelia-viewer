import {
  buildPromptContextSnapshot,
  formatSliceRecipe,
  formatSliceStrategy,
  formatSnapshotSummary,
  formatStudyLabel,
  requestedImageCount,
} from './promptContext';
import type { SnapshotSeries } from '../types/chatTypes';

const series = (over: Partial<SnapshotSeries> = {}): SnapshotSeries => ({
  seriesInstanceUID: 'se-1',
  description: 'Ax T1 post',
  modality: 'MR',
  numFrames: 103,
  ...over,
});

describe('formatStudyLabel', () => {
  it('leads with the date, then the description', () => {
    // The date leads because one patient commonly has several studies.
    expect(formatStudyLabel({ StudyDate: '20260812', StudyDescription: 'Breast MRI' })).toBe(
      '2026-08-12 · Breast MRI'
    );
  });

  it('falls back to date alone, then description alone', () => {
    expect(formatStudyLabel({ StudyDate: '20260812' })).toBe('2026-08-12');
    expect(formatStudyLabel({ StudyDescription: 'Breast MRI' })).toBe('Breast MRI');
  });

  it('falls back to the UID tail when there is no date or description', () => {
    // The tail, not the head: DICOM UIDs share long org prefixes, so only the
    // last segment distinguishes two studies.
    expect(formatStudyLabel({ StudyInstanceUID: '1.2.840.113619.2.55.12345678' })).toBe(
      'Study …12345678'
    );
  });

  it('never returns an empty label, so a chip is never blank', () => {
    expect(formatStudyLabel({})).toBe('Unknown study');
    expect(formatStudyLabel(null)).toBe('Unknown study');
    expect(formatStudyLabel(undefined)).toBe('Unknown study');
    // Whitespace-only fields must not produce a label made of spaces.
    expect(formatStudyLabel({ StudyDescription: '   ', StudyInstanceUID: '   ' })).toBe(
      'Unknown study'
    );
  });

  it('ignores an unparseable DICOM date rather than showing garbage', () => {
    expect(formatStudyLabel({ StudyDate: '2026-08-12', StudyDescription: 'Breast MRI' })).toBe(
      'Breast MRI'
    );
    expect(formatStudyLabel({ StudyDate: '20261399', StudyDescription: 'Breast MRI' })).toBe(
      'Breast MRI'
    );
  });
});

describe('formatSliceStrategy', () => {
  it('names each strategy the middleware supports', () => {
    expect(formatSliceStrategy({ numSlices: 5, strategy: 'central', centralPercentage: 60 })).toBe(
      'central 60%'
    );
    expect(formatSliceStrategy({ numSlices: 5, strategy: 'uniform' })).toBe('uniform');
    expect(formatSliceStrategy({ numSlices: 5, strategy: 'first_n' })).toBe('from the start');
    expect(formatSliceStrategy({ numSlices: 5, strategy: 'last_n' })).toBe('from the end');
  });

  it('omits the percentage when central has none', () => {
    expect(formatSliceStrategy({ numSlices: 5, strategy: 'central' })).toBe('central');
  });

  it('passes through an unrecognized strategy rather than mislabeling it', () => {
    // A strategy added to the middleware but not yet known here must not be
    // silently reported as "central".
    expect(formatSliceStrategy({ numSlices: 5, strategy: 'weighted' })).toBe('weighted');
    expect(formatSliceStrategy({ numSlices: 5, strategy: '' })).toBe('unknown strategy');
  });
});

describe('formatSliceRecipe', () => {
  it('describes the recipe, which is known exactly', () => {
    expect(formatSliceRecipe({ numSlices: 5, strategy: 'central', centralPercentage: 60 })).toBe(
      '5 slices/series · central 60%'
    );
  });

  it('singularizes a one-slice request', () => {
    expect(formatSliceRecipe({ numSlices: 1, strategy: 'uniform' })).toBe(
      '1 slice/series · uniform'
    );
  });
});

describe('requestedImageCount', () => {
  it('sums the per-series clamp the middleware applies', () => {
    // extract_slices does min(num_slices, total_slices) per series.
    expect(requestedImageCount([series({ numFrames: 103 })], 5)).toBe(5);
    expect(requestedImageCount([series({ numFrames: 3 })], 5)).toBe(3);
  });

  it('adds up across series', () => {
    expect(requestedImageCount([series({ numFrames: 103 }), series({ numFrames: 88 })], 5)).toBe(
      10
    );
    // Mixed: one series shorter than the request.
    expect(requestedImageCount([series({ numFrames: 103 }), series({ numFrames: 2 })], 5)).toBe(7);
  });

  it('never understates the bound when a frame count is unknown', () => {
    // A series reporting 0 frames contributes the full request, not zero — the
    // value is an upper bound and must not read lower than what may be sent.
    expect(requestedImageCount([series({ numFrames: 0 })], 5)).toBe(5);
  });

  it('is zero for no series or a non-positive request', () => {
    expect(requestedImageCount([], 5)).toBe(0);
    expect(requestedImageCount([series()], 0)).toBe(0);
    expect(requestedImageCount([series()], -1)).toBe(0);
  });
});

describe('buildPromptContextSnapshot', () => {
  const input = {
    studyInstanceUID: 'study-1',
    study: { StudyDate: '20260812', StudyDescription: 'Breast MRI' },
    series: [series()],
    provider: 'cloud' as const,
    model: 'gemma4:31b',
    sliceRecipe: { numSlices: 8, strategy: 'central', centralPercentage: 60 },
  };

  it('resolves the label and the image bound at capture time', () => {
    const snap = buildPromptContextSnapshot(input);
    expect(snap.studyLabel).toBe('2026-08-12 · Breast MRI');
    expect(snap.requestedImageCount).toBe(8);
    expect(snap.studyInstanceUID).toBe('study-1');
    expect(snap.provider).toBe('cloud');
  });

  it('keeps the full model tag verbatim for audit', () => {
    // The header shortens the name for display; the snapshot must not, because
    // :Q4_K_M and :F16 are different models to an auditor.
    const snap = buildPromptContextSnapshot({
      ...input,
      model: 'thiagomoraes/medgemma-1.5-4b-it:Q4_K_M',
    });
    expect(snap.model).toBe('thiagomoraes/medgemma-1.5-4b-it:Q4_K_M');
  });

  it('deep-copies the series so later selection changes cannot rewrite history', () => {
    // This is the immutability guarantee: the panel's selection keeps mutating
    // after send, and a stored snapshot must not follow it.
    const live = [series({ description: 'Ax T1 post' })];
    const snap = buildPromptContextSnapshot({ ...input, series: live });

    live[0].description = 'Something else entirely';
    live.push(series({ seriesInstanceUID: 'se-2' }));

    expect(snap.series).toHaveLength(1);
    expect(snap.series[0].description).toBe('Ax T1 post');
  });

  it('copies the slice recipe too', () => {
    const recipe = { numSlices: 8, strategy: 'central', centralPercentage: 60 };
    const snap = buildPromptContextSnapshot({ ...input, sliceRecipe: recipe });
    recipe.numSlices = 99;
    expect(snap.sliceRecipe.numSlices).toBe(8);
  });
});

describe('formatSnapshotSummary', () => {
  const base = buildPromptContextSnapshot({
    studyInstanceUID: 'study-1',
    study: { StudyDate: '20260812' },
    series: [series()],
    provider: 'cloud',
    model: 'gemma4:31b',
    sliceRecipe: { numSlices: 8, strategy: 'central', centralPercentage: 60 },
  });

  it('names the single series, the image bound and the model', () => {
    expect(formatSnapshotSummary(base, 'Gemma 4')).toBe('Ax T1 post · 8 images · Gemma 4');
  });

  it('omits the slice recipe, which would elide in a 270px panel', () => {
    // The recipe belongs to the expanded view; an elided provenance line is worse
    // than a terse one because the reader cannot tell what was dropped.
    expect(formatSnapshotSummary(base, 'Gemma 4')).not.toContain('slices/series');
  });

  it('counts series instead of naming them when several are attached', () => {
    const snap = buildPromptContextSnapshot({
      studyInstanceUID: 'study-1',
      series: [series(), series({ seriesInstanceUID: 'se-2', description: 'Ax T2' })],
      provider: 'local',
      model: 'medgemma',
      sliceRecipe: { numSlices: 5, strategy: 'uniform' },
    });
    expect(formatSnapshotSummary(snap, 'MedGemma')).toBe('2 series · 10 images · MedGemma');
  });

  it('says plainly when no images were attached', () => {
    // A text-only answer must not be presented as if it were read from imaging.
    const snap = buildPromptContextSnapshot({
      studyInstanceUID: 'study-1',
      series: [],
      provider: 'local',
      model: 'medgemma',
      sliceRecipe: { numSlices: 5, strategy: 'central', centralPercentage: 60 },
    });
    const summary = formatSnapshotSummary(snap, 'MedGemma');
    expect(summary).toBe('No images · MedGemma');
    expect(summary).not.toContain('slices/series');
  });

  it('singularizes a single image', () => {
    const snap = buildPromptContextSnapshot({
      studyInstanceUID: 'study-1',
      series: [series({ numFrames: 1 })],
      provider: 'local',
      model: 'medgemma',
      sliceRecipe: { numSlices: 1, strategy: 'uniform' },
    });
    expect(formatSnapshotSummary(snap, 'MedGemma')).toContain('1 image ·');
  });

  it('omits the model when its label is empty rather than leaving a dangling separator', () => {
    expect(formatSnapshotSummary(base, '')).toBe('Ax T1 post · 8 images');
  });
});
