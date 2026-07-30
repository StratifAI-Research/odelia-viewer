import React from 'react';
import { render, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import getPanelModule from './getPanelModule';
import { installConsoleErrorFilter, makeServicesManager, withSystem } from './test-utils/harness';

// Harness managers passed to the panel-module factory. The seriesList panel
// resolves utility modules + the active data source through the extension
// manager at render time, so provide those entries.
function makeManagers(overrides: any = {}) {
  const servicesManager = makeServicesManager({
    services: {
      displaySetService: {
        activeDisplaySets: [],
        getActiveDisplaySets: jest.fn(() => []),
        getDisplaySetByUID: jest.fn(() => null),
        getDisplaySetsForSeries: jest.fn(() => []),
        subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
        EVENTS: { DISPLAY_SETS_CHANGED: 'changed', DISPLAY_SETS_ADDED: 'added' },
      },
      hangingProtocolService: {
        getActiveProtocol: jest.fn(() => ({})),
        getViewportsRequireUpdate: jest.fn(() => []),
      },
      uiNotificationService: { show: jest.fn() },
      uiDialogService: { show: jest.fn(), hide: jest.fn() },
      uiModalService: { show: jest.fn() },
      customizationService: { getCustomization: jest.fn(() => undefined) },
      studyPrefetcherService: {
        subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
        EVENTS: {},
      },
      aiResultsService: {
        EVENTS: {},
        subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
        getSelectedAIResult: jest.fn(() => null),
        getAIResultMetadata: jest.fn(() => []),
        setSelectedAIResult: jest.fn(),
      },
      userAuthenticationService: { getUser: jest.fn(() => null) },
    },
  });
  const commandsManager = { runCommand: jest.fn() };
  const extensionManager = {
    getActiveDataSource: jest.fn(() => [
      {
        query: { studies: { search: jest.fn(async () => []) } },
        getImageIdsForDisplaySet: jest.fn(() => []),
      },
    ]),
    getModuleEntry: jest.fn((id: string) => {
      if (id === '@ohif/extension-default.utilityModule.common') {
        return { exports: { getStudiesForPatientByMRN: jest.fn(async () => []) } };
      }
      if (id === '@ohif/extension-cornerstone.utilityModule.common') {
        return { exports: { getCornerstoneLibraries: () => ({ cornerstone: {} }) } };
      }
      return undefined;
    }),
    ...overrides,
  };
  return { servicesManager, commandsManager, extensionManager };
}

installConsoleErrorFilter({ silenceLog: true, silenceWarn: true });

beforeEach(() => {
  jest.clearAllMocks();
});

describe('getPanelModule', () => {
  it('registers the three AI-result side panels in order', () => {
    const panels = getPanelModule(makeManagers());
    expect(panels.map(p => p.name)).toEqual(['seriesList', 'aiFeedback', 'aiChat']);
  });

  it('declares the expected label/icon metadata per panel', () => {
    const panels = getPanelModule(makeManagers());
    const byName = Object.fromEntries(panels.map(p => [p.name, p]));

    expect(byName.seriesList).toMatchObject({ iconName: 'tab-studies', iconLabel: 'Studies' });
    expect(byName.aiFeedback).toMatchObject({
      iconName: 'tab-linear',
      iconLabel: 'Feedback',
      label: 'Feedback',
    });
    expect(byName.aiChat).toMatchObject({
      iconName: 'tab-patient-info',
      iconLabel: 'AI Chat',
      label: 'AI Chat',
    });
  });

  it('gives every panel a renderable component', () => {
    const panels = getPanelModule(makeManagers());
    panels.forEach(p => expect(typeof p.component).toBe('function'));
  });

  it('smoke-renders the seriesList study-browser panel', async () => {
    const managers = makeManagers();
    withSystem(managers.servicesManager);
    (globalThis as any).__OHIF_SYSTEM__ = {
      servicesManager: managers.servicesManager,
      commandsManager: managers.commandsManager,
      extensionManager: managers.extensionManager,
    };
    const [seriesList] = getPanelModule(managers);
    const Component = seriesList.component;
    let utils: any;
    await act(async () => {
      utils = render(
        <MemoryRouter>
          <Component />
        </MemoryRouter>
      );
    });
    expect(utils.container.querySelector('[data-testid="study-browser-header"]')).toBeTruthy();
  });

  it('smoke-renders the aiFeedback panel', async () => {
    const managers = makeManagers();
    withSystem(managers.servicesManager);
    (globalThis as any).__OHIF_SYSTEM__ = {
      servicesManager: managers.servicesManager,
      commandsManager: managers.commandsManager,
      extensionManager: managers.extensionManager,
    };
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ users: [] }),
      text: async () => '',
    });
    const feedback = getPanelModule(managers).find(p => p.name === 'aiFeedback')!;
    const Component = feedback.component;
    let utils: any;
    await act(async () => {
      utils = render(<Component />);
    });
    await act(async () => {
      await Promise.resolve();
    });
    expect(utils.container.firstChild).toBeTruthy();
  });

  it('smoke-renders the aiChat panel', async () => {
    const managers = makeManagers();
    withSystem(managers.servicesManager);
    (globalThis as any).__OHIF_SYSTEM__ = {
      servicesManager: managers.servicesManager,
      commandsManager: managers.commandsManager,
      extensionManager: managers.extensionManager,
    };
    (Element.prototype as any).scrollIntoView = jest.fn();
    const chat = getPanelModule(managers).find(p => p.name === 'aiChat')!;
    const Component = chat.component;
    let utils: any;
    await act(async () => {
      utils = render(<Component />);
    });
    expect(utils.container.firstChild).toBeTruthy();
  });
});
