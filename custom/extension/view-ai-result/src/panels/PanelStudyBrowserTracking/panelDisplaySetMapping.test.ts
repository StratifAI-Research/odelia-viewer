import {
  getComponentType,
  getImageIdForThumbnail,
  mapDataSourceStudies,
  mapDisplaySets,
  findTabAndStudyOfDisplaySet,
} from './panelDisplaySetMapping';

const mr = (over: any = {}) => ({
  displaySetInstanceUID: 'mr-1',
  Modality: 'MR',
  SeriesInstanceUID: 'se-mr-1',
  SeriesDescription: 'T1 axial',
  SeriesNumber: 1,
  StudyInstanceUID: 'study-1',
  numImageFrames: 30,
  SeriesDate: '20240315',
  ...over,
});
const sr = (over: any = {}) => ({
  displaySetInstanceUID: 'sr-1',
  Modality: 'SR',
  SeriesInstanceUID: 'se-sr-1',
  SeriesDescription: 'AI Report',
  SeriesNumber: 99,
  StudyInstanceUID: 'study-1',
  numImageFrames: 1,
  instance: { InstanceCreationDate: '20240315', InstanceCreationTime: '100000' },
  ...over,
});

describe('getComponentType', () => {
  it('classifies no-image modalities and unsupported sets', () => {
    expect(getComponentType(mr())).toBe('thumbnailTracked');
    expect(getComponentType(sr())).toBe('thumbnailNoImage'); // SR is in the no-image list
    expect(getComponentType({ Modality: 'MR', unsupported: true })).toBe('thumbnailNoImage');
  });
});

describe('getImageIdForThumbnail', () => {
  it('returns the middle image id for a normal display set', () => {
    expect(getImageIdForThumbnail({}, ['a', 'b', 'c'])).toBe('b');
  });
  it('returns the middle image id of the middle time point for a dynamic volume', () => {
    const ds = {
      isDynamicVolume: true,
      dynamicVolumeInfo: { timePoints: [['t0a', 't0b'], ['t1a', 't1b', 't1c']] },
    };
    expect(getImageIdForThumbnail(ds, [])).toBe('t1b');
  });
});

describe('mapDataSourceStudies', () => {
  it('naturalizes the data source study shape', () => {
    const [out] = mapDataSourceStudies([
      { studyInstanceUid: 's1', date: '20240315', description: 'CT', instances: 3, modalities: 'CT', mrn: 'm1' },
    ]);
    expect(out).toMatchObject({
      StudyInstanceUID: 's1',
      StudyDate: '20240315',
      StudyDescription: 'CT',
      NumInstances: 3,
      ModalitiesInStudy: 'CT',
      PatientID: 'm1',
    });
  });
});

describe('mapDisplaySets', () => {
  const base = {
    displaySetLoadingState: {},
    thumbnailImageSrcMap: {},
    trackedSeriesInstanceUIDs: [],
    selectedSRUID: null as string | null,
  };

  it('builds thumbnail props and marks AI results with the AI css class', () => {
    const out = mapDisplaySets({ ...base, displaySets: [mr(), sr()] });
    const mrOut = out.find(o => o.displaySetInstanceUID === 'mr-1');
    const srOut = out.find(o => o.displaySetInstanceUID === 'sr-1');
    expect(mrOut.className).toBe('');
    expect(mrOut.description).toBe('T1 axial');
    expect(srOut.className).toBe('ai-result-thumbnail');
    expect(srOut.description).toContain('🤖');
  });

  it('adds the selected class only to the selected SR', () => {
    const out = mapDisplaySets({ ...base, displaySets: [sr()], selectedSRUID: 'sr-1' });
    expect(out[0].className).toBe('ai-result-thumbnail selected');
  });

  it('does not mutate cached static props and returns fresh objects each call', () => {
    const cache = new Map();
    const first = mapDisplaySets({ ...base, displaySets: [sr()], selectedSRUID: 'sr-1', thumbnailPropsCache: cache });
    // Second call: same cache, different dynamic inputs (deselected, loading, image).
    const second = mapDisplaySets({
      ...base,
      displaySets: [sr()],
      selectedSRUID: null,
      displaySetLoadingState: { 'sr-1': 42 },
      thumbnailImageSrcMap: { 'sr-1': 'data:image/png;base64,ZZ' },
      thumbnailPropsCache: cache,
    });

    // Fresh object identity each call (no in-place mutation of the cached one).
    expect(second[0]).not.toBe(first[0]);
    // Dynamic props reflect the second call's inputs...
    expect(second[0].className).toBe('ai-result-thumbnail'); // deselected
    expect(second[0].loadingProgress).toBe(42);
    expect(second[0].imageSrc).toBe('data:image/png;base64,ZZ');
    // ...while the first result is untouched by the second call.
    expect(first[0].className).toBe('ai-result-thumbnail selected');
    expect(first[0].loadingProgress).toBeUndefined();
  });

  it('skips display sets excluded from the thumbnail browser', () => {
    const out = mapDisplaySets({ ...base, displaySets: [mr({ excludeFromThumbnailBrowser: true })] });
    expect(out).toHaveLength(0);
  });
});

describe('findTabAndStudyOfDisplaySet', () => {
  const tabs = [
    {
      name: 'all',
      studies: [
        {
          studyInstanceUid: 'study-1',
          originals: [{ displaySetInstanceUID: 'mr-1' }],
          aiGroups: [{ displaySets: [{ displaySetInstanceUID: 'sr-1' }] }],
        },
        { studyInstanceUid: 'study-2', displaySets: [{ displaySetInstanceUID: 'ct-9' }] },
      ],
    },
  ];

  it('finds a display set in originals, aiGroups, or flat displaySets', () => {
    expect(findTabAndStudyOfDisplaySet('mr-1', tabs)).toEqual({ tabName: 'all', StudyInstanceUID: 'study-1' });
    expect(findTabAndStudyOfDisplaySet('sr-1', tabs)).toEqual({ tabName: 'all', StudyInstanceUID: 'study-1' });
    expect(findTabAndStudyOfDisplaySet('ct-9', tabs)).toEqual({ tabName: 'all', StudyInstanceUID: 'study-2' });
  });

  it('returns undefined when the display set is not present', () => {
    expect(findTabAndStudyOfDisplaySet('nope', tabs)).toBeUndefined();
  });
});
