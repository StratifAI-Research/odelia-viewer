import React from 'react';
import { render, act } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import getPanelModule from './getPanelModule';
import { VIEW_AI_RESULT_ICONS } from './icons';
// The real registry, not the `@ohif/ui-next` mock: that mock is a Proxy whose
// every property is a component, so asserting against it would pass for any
// string at all.
import { Icons as UpstreamIcons } from '../../../../platform/ui-next/src/components/Icons/Icons';
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
      iconName: 'odelia-ai-feedback',
      iconLabel: 'Feedback',
      label: 'Feedback',
    });
    expect(byName.aiChat).toMatchObject({
      iconName: 'odelia-ai-chat',
      iconLabel: 'AI Chat',
      label: 'AI Chat',
    });
  });

  // Icons.ByName resolves these strings against a shared registry and silently
  // renders a literal "Missing Icon" box for a name that is not in it, so a typo
  // — or an icon this extension declares but forgets to register — is only ever
  // caught by eye. (It had not been: the labeling extension shipped a
  // 'list-bullets' panel icon that has never existed.)
  it('declares only icon names that will resolve at runtime', () => {
    // What Icons holds once preRegistration has run: upstream's set plus ours.
    const available = new Set([
      ...Object.keys(UpstreamIcons),
      ...Object.keys(VIEW_AI_RESULT_ICONS),
    ]);

    // Guard the guard — a set that accepted anything would make this vacuous.
    expect(available.has('list-bullets')).toBe(false);

    const panels = getPanelModule(makeManagers());
    expect(panels.length).toBeGreaterThan(0);
    panels.forEach(panel => {
      expect([panel.name, available.has(panel.iconName as string)]).toEqual([panel.name, true]);
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
