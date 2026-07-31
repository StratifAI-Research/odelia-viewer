import { formatClassification, getAISummaryLines } from './formatClassification';
import type { AIResult, Classification } from '../types';

const cls = (over: Partial<Classification> = {}): Classification =>
  ({ side: 'Left', result: 'Benign', confidence: 12.34, ...over }) as Classification;

describe('formatClassification', () => {
  it('renders the result with a one-decimal score', () => {
    expect(formatClassification(cls())).toBe('Benign (12.3%)');
  });

  it('renders a missing side as unknown rather than dropping it', () => {
    expect(formatClassification(undefined)).toBe('--');
  });

  it('prefers the model error message over the score', () => {
    expect(formatClassification(cls({ errorMessage: 'Series missing' }))).toBe('Series missing');
  });

  it('marks an absent score without pretending it is zero', () => {
    expect(formatClassification(cls({ confidence: null }))).toBe('Benign (--%)');
  });

  it('marks an absent result as Unknown', () => {
    expect(formatClassification(cls({ result: null }))).toBe('Unknown (12.3%)');
  });

  it('keeps a zero score visible', () => {
    expect(formatClassification(cls({ confidence: 0 }))).toBe('Benign (0.0%)');
  });
});

describe('getAISummaryLines', () => {
  it('picks each side out of the classification list', () => {
    const aiResult = {
      modelInfo: { name: 'ODELIA-Net' },
      classifications: [
        cls({ side: 'Right', result: 'Malignant', confidence: 88.76 }),
        cls({ side: 'Left', result: 'Benign', confidence: 12.34 }),
      ],
    } as AIResult;

    expect(getAISummaryLines(aiResult)).toEqual({
      model: 'ODELIA-Net',
      left: 'Benign (12.3%)',
      right: 'Malignant (88.8%)',
    });
  });

  it('falls back to a generic model name and empty sides', () => {
    expect(getAISummaryLines({} as AIResult)).toEqual({
      model: 'AI Model',
      left: '--',
      right: '--',
    });
  });
});
