import React from 'react';
import { render } from '@testing-library/react';
import { AIResult } from '../types';

export function makeServicesManager(overrides: Record<string, any> = {}) {
  return {
    services: {
      displaySetService: {
        getActiveDisplaySets: jest.fn(() => []),
        getDisplaySetsForSeries: jest.fn(() => []),
        subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
        EVENTS: {},
      },
      viewportGridService: {
        getState: jest.fn(() => ({ viewports: new Map(), activeViewportId: 'v1' })),
        subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
        EVENTS: {},
      },
      uiNotificationService: { show: jest.fn() },
      hangingProtocolService: { getActiveProtocol: jest.fn(() => ({})) },
      ...((overrides as any).services || {}),
    },
    ...overrides,
  };
}

export function withSystem(servicesManager: any) {
  (globalThis as any).__OHIF_SYSTEM__ = {
    servicesManager,
    commandsManager: { runCommand: jest.fn() },
    extensionManager: { getModuleEntry: jest.fn() },
  };
}

export function renderWithProviders(ui: React.ReactElement) {
  return render(ui);
}

export const makeStudy = (o: Partial<any> = {}) => ({
  StudyInstanceUID: 's1',
  StudyDate: '20240315',
  series: [],
  ...o,
});
export const makeDisplaySet = (o: Partial<any> = {}) => ({
  displaySetInstanceUID: 'ds1',
  SeriesInstanceUID: 'se1',
  Modality: 'MR',
  images: [],
  ...o,
});
// Match the real `AIResult` shape (classifications array, hasHeatmap)
// so the fixture cannot drift from production types.
export const makeAIResult = (o: Partial<AIResult> = {}): AIResult => ({
  studyInstanceUID: 's1',
  hasHeatmap: false,
  classifications: [],
  ...o,
});

// Swallow only the environmental testing-library/React `ReactDOMTestUtils.act`
// deprecation (it fires on first render and is not a real failure) while
// re-emitting every other console.error so genuine errors still surface.
// Optionally silence console.log / console.warn noise for the suite. Registers
// its own beforeAll/afterAll, so call once at the top level of a suite.
export function installConsoleErrorFilter({
  silenceLog = false,
  silenceWarn = false,
}: { silenceLog?: boolean; silenceWarn?: boolean } = {}) {
  const realError = console.error;
  beforeAll(() => {
    if (silenceLog) {
      jest.spyOn(console, 'log').mockImplementation(() => {});
    }
    if (silenceWarn) {
      jest.spyOn(console, 'warn').mockImplementation(() => {});
    }
    jest.spyOn(console, 'error').mockImplementation((...args: any[]) => {
      if (typeof args[0] === 'string' && args[0].includes('ReactDOMTestUtils.act')) {
        return;
      }
      realError(...args);
    });
  });
  afterAll(() => {
    if (silenceLog) {
      (console.log as jest.Mock).mockRestore();
    }
    if (silenceWarn) {
      (console.warn as jest.Mock).mockRestore();
    }
    (console.error as jest.Mock).mockRestore();
  });
}
