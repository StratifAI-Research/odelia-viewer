import {
  createStudyAIBrowserTabsNested,
  clearNestedTabCache,
} from './createStudyAIBrowserTabsNested';

const originalThumb = (over: any = {}) => ({
  StudyInstanceUID: 'study-1',
  SeriesInstanceUID: 'series-a',
  Modality: 'MR',
  displaySetInstanceUID: 'orig-1',
  StudyDate: '20240315',
  ...over,
});

const aiThumb = (over: any = {}) => ({
  StudyInstanceUID: 'study-1',
  Modality: 'SR',
  displaySetInstanceUID: 'ai-1',
  instance: {
    InstanceCreationDate: '20240101',
    InstanceCreationTime: '120000',
  },
  ...over,
});

beforeEach(() => clearNestedTabCache());

describe('createStudyAIBrowserTabsNested', () => {
  it('always returns a single "All Studies" tab', () => {
    const tabs = createStudyAIBrowserTabsNested([], [], []);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ name: 'all', label: 'All Studies' });
    expect(tabs[0].studies).toEqual([]);
  });

  it('splits a study into flat originals and grouped AI results', () => {
    const tabs = createStudyAIBrowserTabsNested(['study-1'], [], [originalThumb(), aiThumb()]);
    const study = tabs[0].studies[0];
    expect(study.studyInstanceUid).toBe('study-1');
    expect(study.originals.map((d: any) => d.displaySetInstanceUID)).toEqual(['orig-1']);
    expect(study.aiGroups).toHaveLength(1);
    expect(study.aiGroups[0].displaySets.map((d: any) => d.displaySetInstanceUID)).toEqual(['ai-1']);
  });

  it('collects SR and SC of the same run into one AI group', () => {
    const sr = aiThumb({ displaySetInstanceUID: 'ai-sr', Modality: 'SR' });
    const sc = aiThumb({ displaySetInstanceUID: 'ai-sc', Modality: 'SC' });
    const tabs = createStudyAIBrowserTabsNested(['study-1'], [], [sr, sc]);
    const groups = tabs[0].studies[0].aiGroups;
    expect(groups).toHaveLength(1);
    expect(groups[0].displaySets.map((d: any) => d.displaySetInstanceUID)).toEqual(['ai-sr', 'ai-sc']);
  });

  it('labels a group with the model name and includes a newline separator', () => {
    const sr = aiThumb({
      displaySetInstanceUID: 'ai-model',
      instance: {
        InstanceCreationDate: '20240101',
        InstanceCreationTime: '120000',
        ContentSequence: [
          {
            ConceptNameCodeSequence: [{ CodeMeaning: 'AI Model' }],
            TextValue: 'BreastNet',
          },
        ],
      },
    });
    const tabs = createStudyAIBrowserTabsNested(['study-1'], [], [sr]);
    const label = tabs[0].studies[0].aiGroups[0].label as string;
    expect(label.split('\n')[0]).toBe('BreastNet');
  });

  it('defaults the model name to "AI Model" when none is present', () => {
    const tabs = createStudyAIBrowserTabsNested(['study-1'], [], [aiThumb()]);
    const label = tabs[0].studies[0].aiGroups[0].label as string;
    expect(label.split('\n')[0]).toBe('AI Model');
  });

  it('keeps AI results lacking a datetime in distinct per-display-set groups', () => {
    const a = aiThumb({ displaySetInstanceUID: 'nd-a', instance: {} });
    const b = aiThumb({ displaySetInstanceUID: 'nd-b', instance: {} });
    const tabs = createStudyAIBrowserTabsNested(['study-1'], [], [a, b]);
    const groups = tabs[0].studies[0].aiGroups;
    expect(groups).toHaveLength(2);
    groups.forEach((g: any) => expect(g.label).toContain('Unknown Date'));
  });

  it('orders primary studies before non-primary ones', () => {
    const dsA = originalThumb({ StudyInstanceUID: 'study-A', displaySetInstanceUID: 'a' });
    const dsB = originalThumb({ StudyInstanceUID: 'study-B', displaySetInstanceUID: 'b' });
    const meta = [
      { studyInstanceUid: 'study-A', date: '20240101' },
      { studyInstanceUid: 'study-B', date: '20240601' },
    ];
    const tabs = createStudyAIBrowserTabsNested(['study-B'], meta, [dsA, dsB]);
    expect(tabs[0].studies.map((s: any) => s.studyInstanceUid)).toEqual(['study-B', 'study-A']);
  });
});
