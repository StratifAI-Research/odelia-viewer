import { AIResultsService } from './AIResultsService';

describe('AIResultsService', () => {
  let service: AIResultsService;

  beforeEach(() => {
    service = new AIResultsService(undefined);
  });

  it('initializes with empty cache', () => {
    expect(service.getCurrentStudyUID()).toBeNull();
  });

  it('exposes static EVENTS', () => {
    expect(AIResultsService.EVENTS.AI_RESULT_SELECTED).toBe('AI_RESULT_SELECTED');
    expect(AIResultsService.EVENTS.AI_RESULT_UPDATED).toBe('AI_RESULT_UPDATED');
    expect(AIResultsService.EVENTS.AI_RESULT_CLEARED).toBe('AI_RESULT_CLEARED');
    expect(AIResultsService.EVENTS.STUDY_CHANGED).toBe('STUDY_CHANGED');
  });

  it('subscribe / unsubscribe works', () => {
    const callback = jest.fn();
    const { unsubscribe } = service.subscribe('AI_RESULT_SELECTED', callback);

    expect(typeof unsubscribe).toBe('function');
    unsubscribe();
  });

  it('clearCache clears all state', () => {
    service.clearCache();
    expect(service.getCurrentStudyUID()).toBeNull();
  });

  it('clearStudyCache removes specific study', () => {
    service.clearStudyCache('1.2.3');
  });

  it('addSelectionChangeListener / removeSelectionChangeListener', () => {
    const cb = jest.fn();
    service.addSelectionChangeListener('1.2.3', cb);
    service.removeSelectionChangeListener('1.2.3', cb);
  });

  it('getAIResults returns null when no display sets', () => {
    const mockServicesManager = {
      services: {
        displaySetService: {
          getActiveDisplaySets: jest.fn().mockReturnValue([]),
        },
      },
    };
    const result = service.getAIResults('1.2.3.4', mockServicesManager);
    expect(result).toBeNull();
  });
});
