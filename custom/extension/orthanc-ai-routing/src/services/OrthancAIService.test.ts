import OrthancAIService from './OrthancAIService';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: jest.fn((key: string) => store[key] || null),
    setItem: jest.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: jest.fn((key: string) => {
      delete store[key];
    }),
    clear: jest.fn(() => {
      store = {};
    }),
  };
})();
Object.defineProperty(window, 'localStorage', { value: localStorageMock });

describe('OrthancAIService', () => {
  let service: OrthancAIService;

  beforeEach(() => {
    localStorageMock.clear();
    service = new OrthancAIService({
      configuration: {
        orthancUrl: 'http://test-orthanc:8042',
      },
    });
  });

  it('initializes with provided configuration', () => {
    expect(service.getCurrentEndpoint()).toBeNull();
  });

  it('setCurrentEndpoint / getCurrentEndpoint round-trips', () => {
    const endpoint = { id: 'ep-1', name: 'My AI', url: 'http://ai:5555' };
    service.setCurrentEndpoint(endpoint);
    expect(service.getCurrentEndpoint()).toEqual(endpoint);
  });

  it('getAIEndpoints returns empty array when localStorage is empty', () => {
    expect(service.getAIEndpoints()).toEqual([]);
  });

  it('getAIEndpoints reads from localStorage', () => {
    const endpoints = [{ id: 'ep-1', name: 'AI', url: 'http://ai' }];
    localStorageMock.setItem('aiEndpoints', JSON.stringify(endpoints));
    expect(service.getAIEndpoints()).toEqual(endpoints);
  });

  it('clearManifestCache does not throw', () => {
    service.clearManifestCache();
  });

  it('stopWorkitemPolling is safe to call when not polling', () => {
    service.stopWorkitemPolling();
  });
});
