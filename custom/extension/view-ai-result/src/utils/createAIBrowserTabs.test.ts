import {
  createAIBrowserTabs,
  clearDisplaySetCache,
  getDisplaySetCacheSize,
} from './createAIBrowserTabs';

// A non-AI (original) series thumbnail.
const originalThumb = (over: any = {}) => ({
  StudyInstanceUID: 'study-1',
  SeriesInstanceUID: 'series-a',
  seriesNumber: 1,
  modality: 'MR',
  description: 'T1',
  numInstances: 3,
  displaySetInstanceUID: 'orig-1',
  StudyDate: '20240315',
  ...over,
});

// An AI-result thumbnail carrying its own instance metadata so no service lookup is needed.
const aiThumb = (over: any = {}) => ({
  StudyInstanceUID: 'study-1',
  Modality: 'SR',
  displaySetInstanceUID: 'ai-1',
  numInstances: 1,
  instance: {
    InstanceCreationDate: '20240101',
    InstanceCreationTime: '120000',
  },
  ...over,
});

beforeEach(() => clearDisplaySetCache());

describe('createAIBrowserTabs', () => {
  it('returns no tabs for an empty display-set list', () => {
    expect(createAIBrowserTabs([], [], [])).toEqual([]);
  });

  it('produces only the Original tab for non-AI series (no All tab when single)', () => {
    const tabs = createAIBrowserTabs(['study-1'], [], [originalThumb()]);
    expect(tabs).toHaveLength(1);
    expect(tabs[0]).toMatchObject({ name: 'original', label: 'Original' });
    expect(tabs[0].studies).toHaveLength(1);
    expect(tabs[0].studies[0].numInstances).toBe(3);
    expect(tabs[0].studies[0].modalities).toBe('MR');
  });

  it('groups AI results by datetime and emits original, ai-0 and All tabs', () => {
    const tabs = createAIBrowserTabs(['study-1'], [], [originalThumb(), aiThumb()]);
    const names = tabs.map(t => t.name);
    expect(names).toEqual(['original', 'ai-0', 'all']);

    const ai0 = tabs.find(t => t.name === 'ai-0')!;
    expect(ai0.studies).toHaveLength(1);
    expect(ai0.studies[0].modalities).toBe('AI');
    expect(ai0.studies[0].displaySets).toHaveLength(1);

    const all = tabs.find(t => t.name === 'all')!;
    expect(all.label).toBe('All');
    // All tab carries every original series plus every AI group.
    expect(all.studies).toHaveLength(2);
  });

  it('places two AI results sharing one datetime in the same group', () => {
    const sr = aiThumb({ displaySetInstanceUID: 'ai-sr', Modality: 'SR' });
    const sc = aiThumb({ displaySetInstanceUID: 'ai-sc', Modality: 'SC' });
    const tabs = createAIBrowserTabs(['study-1'], [], [sr, sc]);
    // No original series -> only the single AI group (no All tab).
    expect(tabs.map(t => t.name)).toEqual(['ai-0']);
    expect(tabs[0].studies[0].displaySets.map((d: any) => d.displaySetInstanceUID)).toEqual([
      'ai-sr',
      'ai-sc',
    ]);
    expect(tabs[0].studies[0].numInstances).toBe(2);
  });

  // A report (SR) carrying a real model name via its ContentSequence.
  const srWithModel = (uid: string, model: string, over: any = {}) => ({
    StudyInstanceUID: 'study-1',
    Modality: 'SR',
    displaySetInstanceUID: uid,
    numInstances: 1,
    instance: {
      InstanceCreationDate: '20240101',
      InstanceCreationTime: '120000',
      ContentSequence: [
        { ConceptNameCodeSequence: [{ CodeMeaning: 'AI Model' }], TextValue: model },
      ],
      ...over,
    },
  });

  it('keeps two different models at the same datetime in separate groups (H-03)', () => {
    const tabs = createAIBrowserTabs(
      ['study-1'],
      [],
      [srWithModel('sr-a', 'ModelA'), srWithModel('sr-b', 'ModelB')]
    );
    const aiGroups = tabs.filter(t => t.name.startsWith('ai-')).map(t => t.studies[0]);
    expect(aiGroups).toHaveLength(2);
    const contents = aiGroups.map(g => g.displaySets.map((d: any) => d.displaySetInstanceUID));
    expect(contents).toEqual(expect.arrayContaining([['sr-a'], ['sr-b']]));
  });

  it('routes a heatmap to its report’s group by referenced UID, not a same-datetime sibling (H-03)', () => {
    const srA = srWithModel('sr-a', 'ModelA', { SOPInstanceUID: 'sop-a' });
    const srB = srWithModel('sr-b', 'ModelB', { SOPInstanceUID: 'sop-b' });
    const scA = {
      StudyInstanceUID: 'study-1',
      Modality: 'SC',
      displaySetInstanceUID: 'sc-a',
      numInstances: 1,
      instance: {
        InstanceCreationDate: '20240101',
        InstanceCreationTime: '120000',
        ReferencedImageSequence: [{ ReferencedSOPInstanceUID: 'sop-a' }],
      },
    };
    const tabs = createAIBrowserTabs(['study-1'], [], [srA, srB, scA]);
    const aiGroups = tabs.filter(t => t.name.startsWith('ai-')).map(t => t.studies[0]);
    expect(aiGroups).toHaveLength(2);
    const groupWithA = aiGroups.find(g =>
      g.displaySets.some((d: any) => d.displaySetInstanceUID === 'sr-a')
    );
    const groupWithB = aiGroups.find(g =>
      g.displaySets.some((d: any) => d.displaySetInstanceUID === 'sr-b')
    );
    // The heatmap joins ModelA's report, not ModelB's same-second report.
    expect(groupWithA.displaySets.map((d: any) => d.displaySetInstanceUID).sort()).toEqual([
      'sc-a',
      'sr-a',
    ]);
    expect(groupWithB.displaySets.map((d: any) => d.displaySetInstanceUID)).toEqual(['sr-b']);
  });

  it('orders AI groups by creation date/time ascending', () => {
    const early = aiThumb({
      displaySetInstanceUID: 'ai-early',
      instance: { InstanceCreationDate: '20240101', InstanceCreationTime: '080000' },
    });
    const late = aiThumb({
      displaySetInstanceUID: 'ai-late',
      instance: { InstanceCreationDate: '20240301', InstanceCreationTime: '090000' },
    });
    // Feed late first to prove the sort, not insertion order, decides position.
    const tabs = createAIBrowserTabs(['study-1'], [], [late, early]);
    const aiTabs = tabs.filter(t => t.name.startsWith('ai-'));
    expect(aiTabs).toHaveLength(2);
    expect(aiTabs[0].studies[0].displaySets[0].displaySetInstanceUID).toBe('ai-early');
    expect(aiTabs[1].studies[0].displaySets[0].displaySetInstanceUID).toBe('ai-late');
  });

  it('routes AI results without a usable date into a missing-date tab', () => {
    const noDate = aiThumb({ displaySetInstanceUID: 'ai-nodate', instance: {} });
    const tabs = createAIBrowserTabs(['study-1'], [], [noDate]);
    expect(tabs.map(t => t.name)).toEqual(['ai-missing-0']);
    expect(tabs[0].studies[0].date).toBe('Date Unknown');
  });
});

describe('clearDisplaySetCache / getDisplaySetCacheSize', () => {
  it('populates and clears the real-display-set cache via the service path', () => {
    const real = aiThumb({ displaySetInstanceUID: 'ai-svc' });
    const servicesManager = {
      services: {
        displaySetService: { getDisplaySetByUID: jest.fn(() => real) },
      },
    };
    createAIBrowserTabs(['study-1'], [], [real], servicesManager);
    expect(getDisplaySetCacheSize()).toBeGreaterThan(0);
    clearDisplaySetCache();
    expect(getDisplaySetCacheSize()).toBe(0);
  });
});
