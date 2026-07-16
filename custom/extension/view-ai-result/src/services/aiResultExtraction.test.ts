import { extractAIResultsForStudy, buildErrorResult, hasUsableAIResultData } from './aiResultExtraction';

const sideProbability = (side: 'Left' | 'Right', code: string, value: string) => ({
  ConceptNameCodeSequence: [{ CodeMeaning: `${side} Side Probability` }],
  ConceptCodeSequence: [{ CodeMeaning: code }],
  MeasuredValueSequence: [{ NumericValue: value }],
});

const modelItem = (text: string) => ({
  ConceptNameCodeSequence: [{ CodeMeaning: 'AI Model' }],
  TextValue: text,
});

const srDisplaySet = (uid: string, opts: any = {}) => ({
  displaySetInstanceUID: uid,
  StudyInstanceUID: 'study-1',
  Modality: 'SR',
  SeriesDescription: 'AI Result',
  instance: {
    ContentSequence: opts.content ?? [
      sideProbability('Left', 'Malignant', '87.5'),
      sideProbability('Right', 'Benign', '91'),
      modelItem('Test Model'),
    ],
    InstanceCreationDate: opts.date ?? '20240315',
    InstanceCreationTime: opts.time ?? '101010',
  },
});

const scDisplaySet = (uid: string, opts: any = {}) => ({
  displaySetInstanceUID: uid,
  StudyInstanceUID: 'study-1',
  Modality: 'SC',
  instance: {
    InstanceCreationDate: opts.date ?? '20240315',
    InstanceCreationTime: opts.time ?? '101010',
  },
});

beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('extractAIResultsForStudy', () => {
  it('returns [] when there are no SR display sets', () => {
    expect(extractAIResultsForStudy([scDisplaySet('sc-1')], 'study-1')).toEqual([]);
  });

  it('builds a result per SR and pairs the heatmap', () => {
    const results = extractAIResultsForStudy([srDisplaySet('sr-1'), scDisplaySet('sc-1')], 'study-1');
    expect(results).toHaveLength(1);
    expect(results[0].displaySetInstanceUID).toBe('sr-1');
    expect(results[0].hasHeatmap).toBe(true);
    expect(results[0].heatmapDisplaySet?.displaySetInstanceUID).toBe('sc-1');
    expect(results[0].modelInfo?.name).toBe('Test Model');
  });

  it('emits an error result (not a throw) when an SR fails to parse', () => {
    const bad = srDisplaySet('sr-bad');
    Object.defineProperty(bad.instance, 'ContentSequence', {
      get() {
        throw new Error('boom');
      },
    });
    const results = extractAIResultsForStudy([bad], 'study-1');
    expect(results).toHaveLength(1);
    expect(results[0].modelInfo?.name).toBe('AI Model (Error)');
    expect(results[0].classifications.every(c => c.errorMessage)).toBe(true);
  });
});

describe('hasUsableAIResultData / buildErrorResult', () => {
  it('treats null/empty data as unusable', () => {
    expect(hasUsableAIResultData(null as any)).toBe(false);
    expect(hasUsableAIResultData({ classifications: [], modelInfo: undefined } as any)).toBe(false);
    expect(hasUsableAIResultData({ classifications: [], modelInfo: { name: 'M' } } as any)).toBe(true);
  });

  it('buildErrorResult carries a resultTs from the display set', () => {
    const r = buildErrorResult(srDisplaySet('sr-1'), 'study-1');
    expect(r.hasHeatmap).toBe(false);
    expect(r.resultTs).toBeDefined();
  });
});
