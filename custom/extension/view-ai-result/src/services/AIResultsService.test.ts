import { AIResultsService } from './AIResultsService';
import { makeServicesManager } from '../test-utils/harness';

// Build a realistic SR display set whose ContentSequence yields classifications
// + model info via extractAIResultData (the service's only data source).
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
  StudyInstanceUID: opts.study ?? 'study-1',
  Modality: 'SR',
  SeriesDescription: opts.desc ?? 'AI Result',
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
  StudyInstanceUID: opts.study ?? 'study-1',
  Modality: 'SC',
  instance: {
    InstanceCreationDate: opts.date ?? '20240315',
    InstanceCreationTime: opts.time ?? '101010',
  },
});

// servicesManager whose displaySetService is backed by an in-memory list.
const managerWith = (displaySets: any[]) => {
  const byUid = new Map(displaySets.map(ds => [ds.displaySetInstanceUID, ds]));
  return makeServicesManager({
    services: {
      displaySetService: {
        getActiveDisplaySets: jest.fn(() => displaySets),
        getDisplaySetByUID: jest.fn((uid: string) => byUid.get(uid) ?? null),
      },
      uiNotificationService: { show: jest.fn() },
    },
  });
};

// Silence the service's heavy console logging so output stays pristine.
let logSpy: jest.SpyInstance, warnSpy: jest.SpyInstance, errSpy: jest.SpyInstance;
beforeEach(() => {
  logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  errSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => {
  logSpy.mockRestore();
  warnSpy.mockRestore();
  errSpy.mockRestore();
  jest.clearAllMocks();
});

describe('AIResultsService', () => {
  it('constructs with a fake uiNotificationService and exposes EVENTS', () => {
    const sm = managerWith([]);
    const svc = new AIResultsService(sm.services.uiNotificationService);
    expect(svc).toBeInstanceOf(AIResultsService);
    expect(svc.EVENTS).toBe(AIResultsService.EVENTS);
    expect(svc.EVENTS.AI_RESULT_SELECTED).toBe('AI_RESULT_SELECTED');
  });

  describe('getAllAIResults', () => {
    it('extracts and returns AI results from SR display sets', () => {
      const sm = managerWith([srDisplaySet('sr-1')]);
      const svc = new AIResultsService(sm.services.uiNotificationService);
      const results = svc.getAllAIResults('study-1', sm);
      expect(results).toHaveLength(1);
      expect(results[0].displaySetInstanceUID).toBe('sr-1');
      expect(results[0].modelInfo?.name).toBe('Test Model');
      expect(results[0].classifications).toHaveLength(2);
      expect(results[0].resultTs).toBeDefined();
    });

    it('sets hasHeatmap when a matching SC exists (same date/time)', () => {
      const sm = managerWith([srDisplaySet('sr-1'), scDisplaySet('sc-1')]);
      const svc = new AIResultsService(sm.services.uiNotificationService);
      const results = svc.getAllAIResults('study-1', sm);
      expect(results[0].hasHeatmap).toBe(true);
      expect(results[0].heatmapDisplaySet?.displaySetInstanceUID).toBe('sc-1');
    });

    it('leaves hasHeatmap false when SC date/time does not match', () => {
      const sm = managerWith([
        srDisplaySet('sr-1'),
        scDisplaySet('sc-1', { time: '120000' }),
      ]);
      const svc = new AIResultsService(sm.services.uiNotificationService);
      const results = svc.getAllAIResults('study-1', sm);
      expect(results[0].hasHeatmap).toBe(false);
    });

    it('returns [] and publishes AI_RESULT_CLEARED when no SR results found', () => {
      const sm = managerWith([]);
      const svc = new AIResultsService(sm.services.uiNotificationService);
      const cleared = jest.fn();
      svc.subscribe(AIResultsService.EVENTS.AI_RESULT_CLEARED, cleared);
      const results = svc.getAllAIResults('study-1', sm);
      expect(results).toEqual([]);
      expect(cleared).toHaveBeenCalledWith(
        expect.objectContaining({ studyInstanceUID: 'study-1', reason: 'no_results' })
      );
    });

    it('caches results; a second call does not re-read display sets', () => {
      const sm = managerWith([srDisplaySet('sr-1')]);
      const svc = new AIResultsService(sm.services.uiNotificationService);
      svc.getAllAIResults('study-1', sm);
      const callsAfterFirst = sm.services.displaySetService.getActiveDisplaySets.mock.calls.length;
      const second = svc.getAllAIResults('study-1', sm);
      expect(second).toHaveLength(1);
      // No further reads of the underlying display sets on cache hit.
      expect(sm.services.displaySetService.getActiveDisplaySets.mock.calls.length).toBe(callsAfterFirst);
    });

    it('re-evaluates hasHeatmap when the matching SC arrives after the SR was cached (VAR-H2)', () => {
      const displaySets: any[] = [srDisplaySet('sr-1')];
      const handlers: Array<() => void> = [];
      const displaySetService = {
        EVENTS: { DISPLAY_SETS_ADDED: 'DISPLAY_SETS_ADDED' },
        getActiveDisplaySets: jest.fn(() => displaySets),
        getDisplaySetByUID: jest.fn(
          (uid: string) => displaySets.find(d => d.displaySetInstanceUID === uid) ?? null
        ),
        subscribe: jest.fn((evt: string, cb: () => void) => {
          if (evt === 'DISPLAY_SETS_ADDED') {
            handlers.push(cb);
          }
          return { unsubscribe: () => {} };
        }),
      };
      const sm = makeServicesManager({
        services: { displaySetService, uiNotificationService: { show: jest.fn() } },
      });
      const svc = new AIResultsService(sm.services.uiNotificationService);

      // First read: only the SR is loaded -> no heatmap, result cached.
      expect(svc.getAllAIResults('study-1', sm)[0].hasHeatmap).toBe(false);

      // The matching SC (heatmap) streams in a beat later.
      displaySets.push(scDisplaySet('sc-1'));
      handlers.forEach(cb => cb()); // displaySetService emits DISPLAY_SETS_ADDED

      // Cache was invalidated -> hasHeatmap is re-evaluated as true.
      expect(svc.getAllAIResults('study-1', sm)[0].hasHeatmap).toBe(true);
    });

    it('produces an error result when extraction throws, without throwing', () => {
      const bad = srDisplaySet('sr-bad');
      // Force extractAIResultData to throw via a getter that explodes.
      Object.defineProperty(bad.instance, 'ContentSequence', {
        get() { throw new Error('boom'); },
      });
      const sm = managerWith([bad]);
      const svc = new AIResultsService(sm.services.uiNotificationService);
      const results = svc.getAllAIResults('study-1', sm);
      expect(results).toHaveLength(1);
      expect(results[0].modelInfo?.name).toBe('AI Model (Error)');
      expect(results[0].classifications.every(c => c.errorMessage)).toBe(true);
    });

    it('shows a multi-result notification when more than one result is found', () => {
      const sm = managerWith([srDisplaySet('sr-1'), srDisplaySet('sr-2', { time: '110000' })]);
      const svc = new AIResultsService(sm.services.uiNotificationService);
      const results = svc.getAllAIResults('study-1', sm);
      expect(results).toHaveLength(2);
      expect(sm.services.uiNotificationService.show).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'warning' })
      );
    });
  });

  describe('getAIResults / getAIResultByDisplaySet', () => {
    it('getAIResults returns the first result, or null when none', () => {
      const sm = managerWith([srDisplaySet('sr-1')]);
      const svc = new AIResultsService(sm.services.uiNotificationService);
      expect(svc.getAIResults('study-1', sm)?.displaySetInstanceUID).toBe('sr-1');

      const empty = managerWith([]);
      const svc2 = new AIResultsService(empty.services.uiNotificationService);
      expect(svc2.getAIResults('study-1', empty)).toBeNull();
    });

    it('getAIResultByDisplaySet returns the result for an SR hit', () => {
      const sm = managerWith([srDisplaySet('sr-1')]);
      const svc = new AIResultsService(sm.services.uiNotificationService);
      const r = svc.getAIResultByDisplaySet('study-1', 'sr-1', sm);
      expect(r?.displaySetInstanceUID).toBe('sr-1');
      expect(r?.modelInfo?.name).toBe('Test Model');
    });

    it('getAIResultByDisplaySet returns null for a miss / non-SR', () => {
      const sm = managerWith([srDisplaySet('sr-1'), scDisplaySet('sc-1')]);
      const svc = new AIResultsService(sm.services.uiNotificationService);
      expect(svc.getAIResultByDisplaySet('study-1', 'nope', sm)).toBeNull();
      expect(svc.getAIResultByDisplaySet('study-1', 'sc-1', sm)).toBeNull();
    });
  });

  describe('getAIResultMetadata', () => {
    it('returns one entry per SR with selection flag', () => {
      const sm = managerWith([srDisplaySet('sr-1'), scDisplaySet('sc-1')]);
      const svc = new AIResultsService(sm.services.uiNotificationService);
      const meta = svc.getAIResultMetadata('study-1', sm);
      expect(meta).toHaveLength(1);
      expect(meta[0]).toMatchObject({ displaySetInstanceUID: 'sr-1', isSelected: false });
    });
  });

  describe('selection + events', () => {
    it('setSelectedAIResult updates state and emits AI_RESULT_SELECTED', () => {
      const sm = managerWith([srDisplaySet('sr-1')]);
      const svc = new AIResultsService(sm.services.uiNotificationService);
      const sel = jest.fn();
      svc.subscribe(AIResultsService.EVENTS.AI_RESULT_SELECTED, sel);

      svc.setSelectedAIResult('study-1', 'sr-1', sm);

      expect(sel).toHaveBeenCalledTimes(1);
      expect(sel.mock.calls[0][0]).toMatchObject({
        studyInstanceUID: 'study-1',
        displaySetInstanceUID: 'sr-1',
        clickedDisplaySetInstanceUID: 'sr-1',
      });
      expect(svc.getSelectedAIResult('study-1', sm)?.displaySetInstanceUID).toBe('sr-1');
    });

    it('setSelectedAIResult is a no-op when re-selecting the same result', () => {
      const sm = managerWith([srDisplaySet('sr-1')]);
      const svc = new AIResultsService(sm.services.uiNotificationService);
      const sel = jest.fn();
      svc.setSelectedAIResult('study-1', 'sr-1', sm);
      svc.subscribe(AIResultsService.EVENTS.AI_RESULT_SELECTED, sel);
      svc.setSelectedAIResult('study-1', 'sr-1', sm);
      expect(sel).not.toHaveBeenCalled();
    });

    it('selecting an SC resolves to its matching SR', () => {
      const sm = managerWith([srDisplaySet('sr-1'), scDisplaySet('sc-1')]);
      const svc = new AIResultsService(sm.services.uiNotificationService);
      const sel = jest.fn();
      svc.subscribe(AIResultsService.EVENTS.AI_RESULT_SELECTED, sel);
      svc.setSelectedAIResult('study-1', 'sc-1', sm);
      expect(sel.mock.calls[0][0]).toMatchObject({
        displaySetInstanceUID: 'sr-1',
        clickedDisplaySetInstanceUID: 'sc-1',
      });
    });

    it('getSelectedAIResult auto-selects the first result when none chosen', () => {
      const sm = managerWith([srDisplaySet('sr-1')]);
      const svc = new AIResultsService(sm.services.uiNotificationService);
      expect(svc.getSelectedAIResult('study-1', sm)?.displaySetInstanceUID).toBe('sr-1');
    });

    it('addSelectionChangeListener fires on selection; removed listener does not', () => {
      const sm = managerWith([srDisplaySet('sr-1'), srDisplaySet('sr-2', { time: '110000' })]);
      const svc = new AIResultsService(sm.services.uiNotificationService);
      const cb = jest.fn();
      svc.addSelectionChangeListener('study-1', cb);
      svc.setSelectedAIResult('study-1', 'sr-1', sm);
      expect(cb).toHaveBeenCalledTimes(1);

      svc.removeSelectionChangeListener('study-1', cb);
      svc.setSelectedAIResult('study-1', 'sr-2', sm);
      expect(cb).toHaveBeenCalledTimes(1);
    });
  });

  describe('subscribe / unsubscribe', () => {
    it('subscriber fires on event and stops after unsubscribe', () => {
      const sm = managerWith([]);
      const svc = new AIResultsService(sm.services.uiNotificationService);
      const cb = jest.fn();
      const sub = svc.subscribe(AIResultsService.EVENTS.AI_RESULT_CLEARED, cb);

      svc.clearStudyCache('study-1');
      expect(cb).toHaveBeenCalledTimes(1);

      sub.unsubscribe();
      svc.clearStudyCache('study-2');
      expect(cb).toHaveBeenCalledTimes(1);
    });

    it('an error in one subscriber does not block others', () => {
      const sm = managerWith([]);
      const svc = new AIResultsService(sm.services.uiNotificationService);
      const good = jest.fn();
      svc.subscribe(AIResultsService.EVENTS.AI_RESULT_CLEARED, () => { throw new Error('x'); });
      svc.subscribe(AIResultsService.EVENTS.AI_RESULT_CLEARED, good);
      svc.clearStudyCache('study-1');
      expect(good).toHaveBeenCalledTimes(1);
    });
  });

  describe('cache invalidation', () => {
    it('clearStudyCache forces a fresh extraction next call', () => {
      const sm = managerWith([srDisplaySet('sr-1')]);
      const svc = new AIResultsService(sm.services.uiNotificationService);
      svc.getAllAIResults('study-1', sm);
      const before = sm.services.displaySetService.getActiveDisplaySets.mock.calls.length;
      svc.clearStudyCache('study-1');
      svc.getAllAIResults('study-1', sm);
      expect(sm.services.displaySetService.getActiveDisplaySets.mock.calls.length).toBeGreaterThan(before);
    });

    it('removeDisplaySetsFromCache drops the removed result and emits cleared', () => {
      const sm = managerWith([srDisplaySet('sr-1'), srDisplaySet('sr-2', { time: '110000' })]);
      const svc = new AIResultsService(sm.services.uiNotificationService);
      svc.getAllAIResults('study-1', sm);
      const cleared = jest.fn();
      svc.subscribe(AIResultsService.EVENTS.AI_RESULT_CLEARED, cleared);

      svc.removeDisplaySetsFromCache('study-1', ['sr-1']);
      expect(cleared).toHaveBeenCalled();
      // Cache hit returns only the surviving result.
      const after = svc.getAllAIResults('study-1', sm);
      expect(after.map(r => r.displaySetInstanceUID)).toEqual(['sr-2']);
    });

    it('removeDisplaySetsFromCache is a no-op when nothing is cached', () => {
      const sm = managerWith([]);
      const svc = new AIResultsService(sm.services.uiNotificationService);
      expect(() => svc.removeDisplaySetsFromCache('study-1', ['x'])).not.toThrow();
    });

    it('clearCache wipes all cached studies and listeners', () => {
      const sm = managerWith([srDisplaySet('sr-1')]);
      const svc = new AIResultsService(sm.services.uiNotificationService);
      const cb = jest.fn();
      svc.addSelectionChangeListener('study-1', cb);
      svc.getAllAIResults('study-1', sm);
      svc.clearCache();
      svc.setSelectedAIResult('study-1', 'sr-1', sm);
      expect(cb).not.toHaveBeenCalled();
    });
  });

  describe('notifyStudyChange', () => {
    it('emits STUDY_CHANGED and updates current study on change', () => {
      const sm = managerWith([srDisplaySet('sr-1')]);
      const svc = new AIResultsService(sm.services.uiNotificationService);
      const changed = jest.fn();
      svc.subscribe(AIResultsService.EVENTS.STUDY_CHANGED, changed);
      svc.notifyStudyChange('study-1', sm);
      expect(svc.getCurrentStudyUID()).toBe('study-1');
      expect(changed).toHaveBeenCalledWith(
        expect.objectContaining({ currentStudyUID: 'study-1', hasAIResults: true })
      );
    });

    it('does nothing when the study is unchanged', () => {
      const sm = managerWith([srDisplaySet('sr-1')]);
      const svc = new AIResultsService(sm.services.uiNotificationService);
      svc.notifyStudyChange('study-1', sm);
      const changed = jest.fn();
      svc.subscribe(AIResultsService.EVENTS.STUDY_CHANGED, changed);
      svc.notifyStudyChange('study-1', sm);
      expect(changed).not.toHaveBeenCalled();
    });
  });
});
