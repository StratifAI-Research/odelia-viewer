import React from 'react';
import { render } from '@testing-library/react';

export function makeServicesManager(overrides: Record<string, any> = {}) {
  return {
    services: {
      displaySetService: { getActiveDisplaySets: jest.fn(() => []), getDisplaySetsForSeries: jest.fn(() => []), subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })), EVENTS: {} },
      viewportGridService: { getState: jest.fn(() => ({ viewports: new Map(), activeViewportId: 'v1' })), subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })), EVENTS: {} },
      uiNotificationService: { show: jest.fn() },
      hangingProtocolService: { getActiveProtocol: jest.fn(() => ({})) },
      ...((overrides as any).services || {}),
    },
    ...overrides,
  };
}

export function withSystem(servicesManager: any) {
  (globalThis as any).__OHIF_SYSTEM__ = { servicesManager, commandsManager: { runCommand: jest.fn() }, extensionManager: { getModuleEntry: jest.fn() } };
}

export function renderWithProviders(ui: React.ReactElement) {
  return render(ui);
}

export const makeStudy = (o: Partial<any> = {}) => ({ StudyInstanceUID: 's1', StudyDate: '20240315', series: [], ...o });
export const makeDisplaySet = (o: Partial<any> = {}) => ({ displaySetInstanceUID: 'ds1', SeriesInstanceUID: 'se1', Modality: 'MR', images: [], ...o });
export const makeAIResult = (o: Partial<any> = {}) => ({ studyInstanceUID: 's1', classification: 'positive', score: 0.9, ...o });
