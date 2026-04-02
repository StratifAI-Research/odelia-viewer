/**
 * Shared mock factories for @ohif/* packages used across custom extensions/modes.
 *
 * Usage in test files:
 *   jest.mock('@ohif/core', () => require('../../test-utils/ohif-mocks').ohifCore);
 *   jest.mock('@ohif/ui',   () => require('../../test-utils/ohif-mocks').ohifUi);
 */

function createMockServicesManager(overrides = {}) {
  return {
    registeredServiceNames: [],
    services: {},
    registerService: jest.fn(),
    getService: jest.fn().mockReturnValue({}),
    ...overrides,
  };
}

function createMockDicomMetadataStore() {
  return {
    getStudy: jest.fn().mockReturnValue({}),
    getSeries: jest.fn().mockReturnValue({}),
    getInstance: jest.fn().mockReturnValue({}),
    addInstance: jest.fn(),
    addSeriesMetadata: jest.fn(),
    addStudy: jest.fn(),
    subscribe: jest.fn().mockReturnValue({ unsubscribe: jest.fn() }),
    EVENTS: {
      INSTANCES_ADDED: 'event::instancesAdded',
      SERIES_ADDED: 'event::seriesAdded',
    },
  };
}

const ohifCore = {
  ServicesManager: jest.fn().mockImplementation(() => createMockServicesManager()),
  DicomMetadataStore: createMockDicomMetadataStore(),
  Types: {},
  defaults: {},
  utils: {
    formatDate: jest.fn(d => d),
    formatPN: jest.fn(n => n),
    sortStudy: jest.fn(),
    sortingCriteria: { seriesSortCriteria: {}, instancesSortCriteria: {} },
  },
  useSystem: jest.fn().mockReturnValue({
    servicesManager: createMockServicesManager(),
    commandsManager: { runCommand: jest.fn() },
    extensionManager: { getModuleEntry: jest.fn() },
  }),
  createMockServicesManager,
  createMockDicomMetadataStore,
};

const noop = () => null;

const ohifUi = {
  Button: noop,
  ButtonGroup: noop,
  ButtonEnums: { type: {}, size: {} },
  Dialog: noop,
  Input: noop,
  MeasurementTable: noop,
  WindowLevelMenuItem: noop,
  useImageViewer: jest.fn().mockReturnValue({
    StudyInstanceUIDs: [],
    displaySets: [],
  }),
  useViewportGrid: jest.fn().mockReturnValue([
    { viewports: new Map(), activeViewportId: null },
    { setActiveViewportId: jest.fn() },
  ]),
  useUserAuthentication: jest.fn().mockReturnValue([
    { user: { sub: 'test-user', name: 'Test' } },
    jest.fn(),
  ]),
};

const ohifExtensionCornerstone = {
  utils: {},
};

const ohifExtensionDefault = {
  requestDisplaySetCreationForStudy: jest.fn(),
  PanelStudyBrowserHeader: noop,
  MoreDropdownMenu: noop,
};

module.exports = {
  ohifCore,
  ohifUi,
  ohifExtensionCornerstone,
  ohifExtensionDefault,
  createMockServicesManager,
  createMockDicomMetadataStore,
};
