import {
  buildPromptContextSnapshot,
  formatSeriesSliceSource,
  formatSliceList,
  formatSliceRecipe,
  formatSliceStrategy,
  formatContextSummary,
  formatSnapshotSummary,
  formatStudyLabel,
  formatWindow,
  requestedImageCount,
} from './promptContext';
import type { SnapshotSeries } from '../types/chatTypes';

const series = (over: Partial<SnapshotSeries> = {}): SnapshotSeries => ({
  displaySetInstanceUID: 'ds',
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

  it('falls back to the accession before the UID, on anonymised data', () => {
    // The real UKA study: no (0008,0020) and no (0008,1030) on any instance,
    // with the cohort identifier left in (0008,0050). "UKA_1" is a label a
    // reader can act on; "Study …5106477" is not.
    expect(
      formatStudyLabel({
        StudyInstanceUID: '1.3.46.670589.16.2.2.10.75.20.10.20100804.123124.5106477',
        AccessionNumber: 'UKA_1',
      })
    ).toBe('UKA_1');
  });

  it('prefers a real date or description over the accession', () => {
    // The accession is a fallback, not an addition: a study that knows its date
    // gains nothing from an accession number beside it.
    expect(formatStudyLabel({ StudyDate: '20260812', AccessionNumber: 'UKA_1' })).toBe(
      '2026-08-12'
    );
    expect(formatStudyLabel({ StudyDescription: 'Breast MRI', AccessionNumber: 'UKA_1' })).toBe(
      'Breast MRI'
    );
  });

  it('falls back to the UID tail when there is no date, description or accession', () => {
    // The tail, not the head: DICOM UIDs share long org prefixes, so only the
    // last segment distinguishes two studies.
    expect(formatStudyLabel({ StudyInstanceUID: '1.2.840.113619.2.55.12345678' })).toBe(
      'Study …12345678'
    );
    // A blank accession must not shadow the UID.
    expect(
      formatStudyLabel({ StudyInstanceUID: '1.2.840.113619.2.55.12345678', AccessionNumber: '  ' })
    ).toBe('Study …12345678');
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

describe('formatContextSummary', () => {
  it('keeps the study, the series and the image count', () => {
    expect(
      formatContextSummary({
        studyLabel: 'UKA_1',
        seriesDescriptions: ['NCI-dyn DEV'],
        imageCount: 5,
        hasRegion: false,
      })
    ).toBe('UKA_1 · NCI-dyn DEV · 5 images');
  });

  it('counts series rather than listing them when there are several', () => {
    // The line has to survive a ~270px panel; three descriptions would elide.
    expect(
      formatContextSummary({
        studyLabel: 'UKA_1',
        seriesDescriptions: ['a', 'b', 'c'],
        imageCount: 15,
        hasRegion: false,
      })
    ).toBe('UKA_1 · 3 series · 15 images');
  });

  it('says a region is in force, because it changes what the images are', () => {
    expect(
      formatContextSummary({
        studyLabel: 'UKA_1',
        seriesDescriptions: ['NCI-dyn DEV'],
        imageCount: 1,
        hasRegion: true,
      })
    ).toBe('UKA_1 · NCI-dyn DEV · 1 image · region');
  });

  it('states "no series" rather than omitting it', () => {
    // A collapsed panel that simply showed the study would look identical
    // whether or not images were attached, which is the one thing it must not do.
    expect(
      formatContextSummary({
        studyLabel: 'UKA_1',
        seriesDescriptions: [],
        imageCount: 0,
        hasRegion: false,
      })
    ).toBe('UKA_1 · no series');
  });
});

describe('formatWindow', () => {
  it('reports width and centre, as the viewer overlay does', () => {
    // Verified against the running viewer: a viewport reporting
    // {lower: 95.1, upper: 1354.1} prints "W:1260 L:725" on the image.
    expect(formatWindow({ lower: 95.11825755436496, upper: 1354.0737785936149 })).toBe(
      'W:1260 L:725'
    );
  });

  // Reported from a running viewer: the footer read "W:1547 L:701" beside an
  // overlay reading "W:1548 L:701". The width was a unit short on every window
  // ever shown, so a reader checking the footer against the screen found it
  // disagreeing every time.
  it('matches the overlay width, which counts both endpoints', () => {
    expect(formatWindow({ lower: -73, upper: 1474 })).toBe('W:1548 L:701');
  });

  // The centre carries the same half-unit, and it is the more insidious half:
  // it only shows up when it crosses a rounding boundary, so it survived the
  // window above, where both roundings happen to land on 701.
  it('matches the overlay centre across a rounding boundary', () => {
    expect(formatWindow({ lower: 100, upper: 1502 })).toBe('W:1403 L:802');
  });

  it('says so when the greyscale is inverted', () => {
    expect(formatWindow({ lower: 0, upper: 100, invert: true })).toBe('W:101 L:51 inverted');
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

  it('counts a series that reports no frames as no images', () => {
    // It has nothing to send, and the composer's own tally already says "0
    // images". The snapshot claiming 5 would contradict the panel that produced it.
    expect(requestedImageCount([series({ numFrames: 0 })], 5)).toBe(0);
  });

  it('never understates the bound when the frame count is unusable', () => {
    // Absent or nonsensical is not the same as zero: the depth is unknown, so the
    // upper bound must not read lower than what may actually be sent.
    expect(requestedImageCount([series({ numFrames: undefined as any })], 5)).toBe(5);
    expect(requestedImageCount([series({ numFrames: NaN })], 5)).toBe(5);
    expect(requestedImageCount([series({ numFrames: -3 })], 5)).toBe(5);
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
    live.push(series({ displaySetInstanceUID: 'ds', seriesInstanceUID: 'se-2' }));

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
      series: [
        series(),
        series({ displaySetInstanceUID: 'ds', seriesInstanceUID: 'se-2', description: 'Ax T2' }),
      ],
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

describe('requestedImageCount with named slices', () => {
  const named = (n: number, frames = 103) => ({
    displaySetInstanceUID: 'ds',
    seriesInstanceUID: 'se',
    description: 'Ax T1',
    modality: 'MR',
    numFrames: frames,
    rangeStart: 18,
    rangeEnd: 62,
    sentSliceNumbers: Array.from({ length: n }, (_, i) => 18 + i),
  });

  it('counts the named slices exactly', () => {
    expect(requestedImageCount([named(12)], 5)).toBe(12);
  });

  it('ignores the configured count when slices were named', () => {
    // The named instances ARE the request; num_slices plays no part.
    expect(requestedImageCount([named(12)], 99)).toBe(12);
  });

  it('counts a zero-slice request as zero rather than falling back', () => {
    expect(requestedImageCount([{ ...named(0) }], 5)).toBe(0);
  });

  it('mixes named and recipe-based series', () => {
    const recipeSeries = {
      displaySetInstanceUID: 'ds',
      seriesInstanceUID: 'se2',
      description: 'Ax T2',
      modality: 'MR',
      numFrames: 40,
    };
    expect(requestedImageCount([named(12), recipeSeries], 5)).toBe(17);
  });
});

describe('formatSliceList', () => {
  it('lists the slice numbers in full', () => {
    expect(formatSliceList([18, 22, 26])).toBe('18, 22, 26');
  });

  it('says so when it truncates, and by how much', () => {
    // A silently shortened audit list would read as the complete one.
    const many = Array.from({ length: 30 }, (_, i) => i + 1);
    expect(formatSliceList(many, 5)).toBe('1, 2, 3, 4, 5, +25 more');
  });

  it('reports an empty selection as none', () => {
    expect(formatSliceList([])).toBe('none');
  });
});

describe('formatSeriesSliceSource', () => {
  const recipe = { numSlices: 5, strategy: 'central', centralPercentage: 60 };

  it('states the range and count when the slices were named', () => {
    const series = {
      displaySetInstanceUID: 'ds',
      seriesInstanceUID: 'se',
      description: 'Ax T1',
      modality: 'MR',
      numFrames: 103,
      rangeStart: 18,
      rangeEnd: 62,
      sentSliceNumbers: [18, 30, 44, 56, 62],
    };
    expect(formatSeriesSliceSource(series, recipe)).toBe('18–62 of 103 · 5 slices · auto window');
  });

  it('names the window the images were rendered with', () => {
    const series = {
      displaySetInstanceUID: 'ds',
      seriesInstanceUID: 'se',
      description: 'Ax T1',
      modality: 'MR',
      numFrames: 103,
      rangeStart: 18,
      rangeEnd: 20,
      sentSliceNumbers: [18, 19, 20],
      // The VOI a running viewport actually reported under a "W:1260 L:725"
      // overlay, rather than round numbers chosen to produce that string.
      voi: { lower: 95.11825755436496, upper: 1354.0737785936149, invert: false },
    };
    expect(formatSeriesSliceSource(series, recipe)).toBe('18–20 of 103 · 3 slices · W:1260 L:725');
  });

  it('says "auto window" rather than staying silent about it', () => {
    // Silence would read as "the window you set" to anyone who had the toggle on
    // for other messages. Which windowing was used is part of what the model saw.
    const series = {
      displaySetInstanceUID: 'ds',
      seriesInstanceUID: 'se',
      description: 'Ax T1',
      modality: 'MR',
      numFrames: 103,
      rangeStart: 18,
      rangeEnd: 20,
      sentSliceNumbers: [18, 19, 20],
    };
    expect(formatSeriesSliceSource(series, recipe)).toContain('auto window');
  });

  it('does not repeat a single-slice range', () => {
    const series = {
      displaySetInstanceUID: 'ds',
      seriesInstanceUID: 'se',
      description: 'Ax T1',
      modality: 'MR',
      numFrames: 103,
      rangeStart: 27,
      rangeEnd: 27,
      sentSliceNumbers: [27],
    };
    expect(formatSeriesSliceSource(series, recipe)).toBe('27 of 103 · 1 slice · auto window');
  });

  it('falls back to the recipe when no slices were named', () => {
    // Worded differently on purpose: a recipe says how slices would be picked,
    // not which pixels went out.
    const series = {
      displaySetInstanceUID: 'ds',
      seriesInstanceUID: 'se',
      description: 'Ax T1',
      modality: 'MR',
      numFrames: 103,
    };
    expect(formatSeriesSliceSource(series, recipe)).toBe('5 slices/series · central 60%');
  });
});
