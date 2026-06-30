import {
  extractAIResultData,
  formatClassificationPreview,
  getModelDisplayName,
} from './extractAIResultData';

const concept = (meaning: string) => ({
  ConceptNameCodeSequence: [{ CodeMeaning: meaning }],
});

const sideProbability = (side: 'Left' | 'Right', code: string, value?: string) => ({
  ...concept(`${side} Side Probability`),
  ConceptCodeSequence: [{ CodeMeaning: code }],
  ...(value !== undefined ? { MeasuredValueSequence: [{ NumericValue: value }] } : {}),
});

const sideAnalysis = (side: 'Left' | 'Right', text?: string) => ({
  ...concept(`${side} Side Analysis`),
  ...(text !== undefined ? { TextValue: text } : {}),
});

const modelItem = (text: string, name?: string, version?: string) => ({
  ...concept('AI Model'),
  TextValue: text,
  ...(name !== undefined ? { AlgorithmName: name } : {}),
  ...(version !== undefined ? { AlgorithmVersion: version } : {}),
});

const srDisplaySet = (items: any[]) => ({
  Modality: 'SR',
  instance: { ContentSequence: items },
});

describe('extractAIResultData', () => {
  it('returns null when displaySet is missing', () => {
    expect(extractAIResultData(undefined)).toBeNull();
    expect(extractAIResultData(null)).toBeNull();
  });

  it('returns null when there is no ContentSequence', () => {
    expect(extractAIResultData({ Modality: 'SR', instance: {} })).toBeNull();
  });

  it('returns null for non-SR/SC modalities even with a ContentSequence', () => {
    expect(extractAIResultData({ Modality: 'MR', instance: { ContentSequence: [] } })).toBeNull();
  });

  it('returns null when the content yields no classifications and no model', () => {
    const ds = srDisplaySet([concept('Something Irrelevant')]);
    expect(extractAIResultData(ds)).toBeNull();
  });

  it('maps a malignant Side Probability with confidence', () => {
    const ds = srDisplaySet([sideProbability('Left', 'Malignant', '87.5')]);
    const out = extractAIResultData(ds);
    expect(out).not.toBeNull();
    expect(out!.isClassification).toBe(true);
    expect(out!.classifications).toEqual([
      { side: 'Left', result: 'Malignant', confidence: 87.5 },
    ]);
  });

  it('maps Benign and "Clinical finding absent" code meanings', () => {
    const ds = srDisplaySet([
      sideProbability('Right', 'Benign', '12'),
      sideProbability('Left', 'Clinical finding absent', '5'),
    ]);
    const out = extractAIResultData(ds)!;
    expect(out.classifications[0]).toMatchObject({ side: 'Right', result: 'Benign' });
    expect(out.classifications[1]).toMatchObject({ side: 'Left', result: 'No lesion' });
  });

  it('leaves confidence null when no NumericValue is provided', () => {
    const ds = srDisplaySet([sideProbability('Left', 'Malignant')]);
    const out = extractAIResultData(ds)!;
    expect(out.classifications[0].confidence).toBeNull();
  });

  it('skips a Side Probability item that has no code meaning', () => {
    const ds = srDisplaySet([
      { ...concept('Left Side Probability') }, // no ConceptCodeSequence
      modelItem('Model X'),
    ]);
    const out = extractAIResultData(ds)!;
    expect(out.classifications).toHaveLength(0);
    expect(out.modelInfo).not.toBeNull();
  });

  it('captures an error classification from Side Analysis', () => {
    const ds = srDisplaySet([sideAnalysis('Right', 'Boom')]);
    const out = extractAIResultData(ds)!;
    expect(out.classifications[0]).toEqual({
      side: 'Right',
      result: null,
      confidence: null,
      errorMessage: 'Boom',
    });
    expect(out.isClassification).toBe(false);
  });

  it('defaults the error message when Side Analysis has no TextValue', () => {
    const ds = srDisplaySet([sideAnalysis('Left')]);
    const out = extractAIResultData(ds)!;
    expect(out.classifications[0].errorMessage).toBe('Analysis failed');
  });

  it('extracts model info from an AI Model item', () => {
    const ds = srDisplaySet([modelItem('My Model', 'algoX', '2.1')]);
    const out = extractAIResultData(ds)!;
    expect(out.modelInfo).toEqual({ name: 'My Model', algorithmName: 'algoX', algorithmVersion: '2.1' });
  });

  it('descends into a CONTAINER root before processing items', () => {
    const ds = srDisplaySet([
      { ValueType: 'CONTAINER', ContentSequence: [sideProbability('Left', 'Malignant', '90')] },
    ]);
    const out = extractAIResultData(ds)!;
    expect(out.classifications[0]).toMatchObject({ side: 'Left', result: 'Malignant', confidence: 90 });
  });

  it('does not throw on malformed input', () => {
    expect(() => extractAIResultData({} as any)).not.toThrow();
    expect(extractAIResultData({} as any)).toBeNull();
  });
});

describe('formatClassificationPreview', () => {
  it('returns empty string for empty or missing input', () => {
    expect(formatClassificationPreview([])).toBe('');
    expect(formatClassificationPreview(undefined as any)).toBe('');
  });

  it('formats a result with confidence to one decimal', () => {
    expect(
      formatClassificationPreview([{ side: 'Left', result: 'Malignant', confidence: 87.49 }])
    ).toBe('Left: Malignant (87.5%)');
  });

  it('uses "Unknown" when result is null and omits confidence when null', () => {
    expect(
      formatClassificationPreview([{ side: 'Right', result: null, confidence: null }])
    ).toBe('Right: Unknown');
  });

  it('renders an error entry and joins multiple entries with a comma', () => {
    expect(
      formatClassificationPreview([
        { side: 'Left', result: 'Benign', confidence: 10 },
        { side: 'Right', result: null, confidence: null, errorMessage: 'oops' },
      ])
    ).toBe('Left: Benign (10.0%), Right: Error');
  });
});

describe('getModelDisplayName', () => {
  it('returns the default name when modelInfo is missing', () => {
    expect(getModelDisplayName(null)).toBe('AI Model');
  });

  it('combines algorithm name and version when both present', () => {
    expect(getModelDisplayName({ algorithmName: 'algo', algorithmVersion: '3' })).toBe('algo v3');
  });

  it('returns just the algorithm name when version is absent', () => {
    expect(getModelDisplayName({ algorithmName: 'algo' })).toBe('algo');
  });

  it('falls back to name then the default', () => {
    expect(getModelDisplayName({ name: 'Friendly' })).toBe('Friendly');
    expect(getModelDisplayName({})).toBe('AI Model');
  });
});
