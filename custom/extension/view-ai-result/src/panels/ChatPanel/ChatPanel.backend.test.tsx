import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  installConsoleErrorFilter,
  makeServicesManager,
  withSystem,
} from '../../test-utils/harness';

import ChatPanel from './ChatPanel';

// Same hook-injection approach as ChatPanel.test.tsx: the panel only needs a
// stable streaming-hook surface for these settings-modal assertions.
const hookState: any = {};

jest.mock('../../hooks/useChatService', () => ({
  useChatService: () => hookState,
}));

function setHook(over: Partial<typeof hookState> = {}) {
  Object.assign(hookState, {
    messages: [],
    isConnected: true,
    isStreaming: false,
    error: null,
    sessionId: 'session-abcdef01',
    preprocessingStatus: null,
    preprocessingProgress: null,
    connect: jest.fn(),
    sendMessage: jest.fn(),
    cancelGeneration: jest.fn(),
    clearHistory: jest.fn(),
    disconnect: jest.fn(),
    ...over,
  });
}

installConsoleErrorFilter();
beforeAll(() => {
  (Element.prototype as any).scrollIntoView = jest.fn();
  (HTMLElement.prototype as any).focus = jest.fn();
});

beforeEach(() => {
  jest.clearAllMocks();
  setHook();
  withSystem(makeServicesManager());
});

const BASE_CONFIG = {
  system_prompt: 'You are helpful',
  model: 'medgemma',
  preprocessing: { num_slices: 5, slice_strategy: 'central', central_percentage: 60 },
  ollama_options: {},
};

/**
 * Route fetch by URL so a test can supply /debug/config and /debug/cloud/models
 * independently.
 */
function routeFetch(routes: Record<string, any>) {
  // `init` is declared so mock.calls entries carry it — the save assertions read
  // calls[n][1].method/.body.
  const fetchMock = jest.fn((url: string, init?: RequestInit) => {
    for (const [suffix, resp] of Object.entries(routes)) {
      if (String(url).includes(suffix)) {
        return Promise.resolve(typeof resp === 'function' ? resp() : resp);
      }
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) });
  });
  (global as any).fetch = fetchMock;
  return fetchMock;
}

const jsonOk = (body: any) => ({ ok: true, status: 200, json: async () => body });

async function openSettings() {
  render(<ChatPanel />);
  await act(async () => {
    fireEvent.click(screen.getByTitle('Settings'));
  });
}

describe('ChatPanel backend selector', () => {
  it('explains how to enable the cloud backend when the operator gate is off', async () => {
    routeFetch({
      '/debug/config': jsonOk({ ...BASE_CONFIG, provider: 'local', cloud_enabled: false }),
    });
    await openSettings();

    expect(screen.getByText(/Ollama Cloud is disabled on this deployment/)).toBeTruthy();
    // No egress warning while local is the only option.
    expect(screen.queryByText(/Images leave this network/)).toBeNull();
  });

  it('treats a middleware with no provider fields as local-only', async () => {
    // An older chat-middleware predating the cloud backend returns none of these
    // keys; the panel must not offer a backend it cannot reach.
    routeFetch({ '/debug/config': jsonOk(BASE_CONFIG) });
    await openSettings();

    expect(screen.getByText(/Ollama Cloud is disabled on this deployment/)).toBeTruthy();
  });

  it('does not fetch the cloud model list while the provider is local', async () => {
    // The listing costs an /api/tags plus one /api/show per model upstream.
    const fetchMock = routeFetch({
      '/debug/config': jsonOk({ ...BASE_CONFIG, provider: 'local', cloud_enabled: true }),
    });
    await openSettings();

    const listCalls = fetchMock.mock.calls.filter(c => String(c[0]).includes('/cloud/models'));
    expect(listCalls).toHaveLength(0);
  });

  it('warns that images leave the network and lists models with vision flags', async () => {
    routeFetch({
      '/debug/config': jsonOk({
        ...BASE_CONFIG,
        provider: 'cloud',
        cloud_enabled: true,
        cloud_configured: true,
        cloud_url: 'https://ollama.com',
        cloud_model: 'seeing:1b',
      }),
      '/cloud/models': jsonOk({
        capabilities_reported: true,
        models: [
          { name: 'seeing:1b', capabilities: ['completion', 'vision'], supports_vision: true },
          { name: 'blind:1b', capabilities: ['completion'], supports_vision: false },
        ],
      }),
    });
    await openSettings();

    expect(screen.getByText(/Images leave this network/)).toBeTruthy();
    expect(screen.getByText(/https:\/\/ollama\.com/)).toBeTruthy();
    // The vision-capable model is marked as such in the picker.
    expect(screen.getByText(/seeing:1b — vision/)).toBeTruthy();
  });

  it('warns when the selected cloud model cannot accept images', async () => {
    // The chat sends DICOM slices, so a text-only pick silently blinds the model.
    routeFetch({
      '/debug/config': jsonOk({
        ...BASE_CONFIG,
        provider: 'cloud',
        cloud_enabled: true,
        cloud_configured: true,
        cloud_model: 'blind:1b',
      }),
      '/cloud/models': jsonOk({
        capabilities_reported: true,
        models: [{ name: 'blind:1b', capabilities: ['completion'], supports_vision: false }],
      }),
    });
    await openSettings();

    expect(screen.getByText(/no vision capability/)).toBeTruthy();
  });

  it('does not claim a model is text-only when the host reported no capabilities', async () => {
    routeFetch({
      '/debug/config': jsonOk({
        ...BASE_CONFIG,
        provider: 'cloud',
        cloud_enabled: true,
        cloud_configured: true,
        cloud_model: 'unknown:1b',
      }),
      '/cloud/models': jsonOk({
        capabilities_reported: false,
        models: [{ name: 'unknown:1b', capabilities: [], supports_vision: false }],
      }),
    });
    await openSettings();

    expect(screen.getByText(/vision support is unknown/)).toBeTruthy();
    expect(screen.queryByText(/no vision capability/)).toBeNull();
  });

  it('tells the operator to set an API key when none is configured', async () => {
    routeFetch({
      '/debug/config': jsonOk({
        ...BASE_CONFIG,
        provider: 'cloud',
        cloud_enabled: true,
        cloud_configured: false,
      }),
    });
    await openSettings();

    expect(screen.getByText(/No API key is configured/)).toBeTruthy();
  });

  it('surfaces the middleware reason when the model listing is rejected', async () => {
    // A rejected key must read as an error, not as "this account has no models".
    routeFetch({
      '/debug/config': jsonOk({
        ...BASE_CONFIG,
        provider: 'cloud',
        cloud_enabled: true,
        cloud_configured: true,
      }),
      '/cloud/models': {
        ok: false,
        status: 502,
        json: async () => ({ detail: 'Model listing failed: HTTP 401' }),
      },
    });
    await openSettings();

    expect(screen.getByText(/Model listing failed: HTTP 401/)).toBeTruthy();
  });

  it('sends the provider and cloud model when saving', async () => {
    const fetchMock = routeFetch({
      '/debug/config': jsonOk({
        ...BASE_CONFIG,
        provider: 'cloud',
        cloud_enabled: true,
        cloud_configured: true,
        cloud_model: 'seeing:1b',
      }),
      '/cloud/models': jsonOk({
        capabilities_reported: true,
        models: [{ name: 'seeing:1b', capabilities: ['vision'], supports_vision: true }],
      }),
    });
    await openSettings();

    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    const put = fetchMock.mock.calls.find(c => (c[1] as any)?.method === 'PUT');
    expect(put).toBeTruthy();
    const body = JSON.parse((put![1] as any).body);
    expect(body.provider).toBe('cloud');
    expect(body.cloud_model).toBe('seeing:1b');
  });

  it('shows the middleware rejection reason when a cloud switch is refused', async () => {
    routeFetch({
      '/debug/config': (() => {
        let calls = 0;
        return () => {
          calls += 1;
          // First call is the initial load (GET); the PUT is rejected.
          if (calls === 1) {
            return jsonOk({
              ...BASE_CONFIG,
              provider: 'local',
              cloud_enabled: true,
              cloud_configured: true,
            });
          }
          return {
            ok: false,
            status: 403,
            json: async () => ({ detail: 'The Ollama Cloud backend is disabled.' }),
          };
        };
      })(),
    });
    await openSettings();

    await act(async () => {
      fireEvent.click(screen.getByText('Save'));
    });

    expect(screen.getByText(/The Ollama Cloud backend is disabled\./)).toBeTruthy();
  });
});
