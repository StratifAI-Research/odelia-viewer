import { renderHook, act } from '@testing-library/react';
import { useAIRouting } from './useAIRouting';
import { AI_ENDPOINT } from '../test-utils/harness';

function makeService(over: Record<string, any> = {}) {
  return {
    getCurrentEndpoint: jest.fn(() => AI_ENDPOINT),
    setCurrentEndpoint: jest.fn(),
    routeSeriesToAI: jest.fn().mockResolvedValue({ status: 'success', workitem_uid: 'w1', message: 'ok' }),
    startWorkitemPolling: jest.fn(),
    stopWorkitemPolling: jest.fn(),
    ...over,
  };
}

function setup(over: Record<string, any> = {}, onComplete?: () => void) {
  const svc = makeService(over);
  const ui = { show: jest.fn() };
  const hook = renderHook(() =>
    useAIRouting({ orthancAIService: svc as any, uiNotificationService: ui, onComplete })
  );
  return { svc, ui, ...hook };
}

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

describe('useAIRouting', () => {
  it('loads the current endpoint on mount', () => {
    const { result, svc } = setup();
    expect(svc.getCurrentEndpoint).toHaveBeenCalled();
    expect(result.current.currentEndpoint).toEqual(AI_ENDPOINT);
  });

  it('handleEndpointChange updates state, persists, and shows an info toast', () => {
    const { result, svc, ui } = setup();
    const next = { id: 'ep-2', name: 'other', url: 'http://other' };
    act(() => result.current.handleEndpointChange(next));
    expect(result.current.currentEndpoint).toEqual(next);
    expect(svc.setCurrentEndpoint).toHaveBeenCalledWith(next);
    expect(ui.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'info' }));
  });

  it('sendToAI returns false and sets an error when no endpoint is configured', async () => {
    const { result } = setup({ getCurrentEndpoint: jest.fn(() => null) });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.sendToAI('1.2', ['s1']);
    });
    expect(ok).toBe(false);
    expect(result.current.error).toMatch(/No AI endpoint/);
  });

  it('sendToAI returns false when no series are selected', async () => {
    const { result } = setup();
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.sendToAI('1.2', []);
    });
    expect(ok).toBe(false);
    expect(result.current.error).toMatch(/No series/);
  });

  it('success with a workitem_uid starts polling; a COMPLETED update fires onComplete', async () => {
    const onComplete = jest.fn();
    const { result, svc, ui } = setup({}, onComplete);

    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.sendToAI('1.2', ['s1']);
    });
    expect(ok).toBe(true);
    expect(result.current.status).toBe('checking');
    expect(result.current.workitemUid).toBe('w1');
    expect(svc.startWorkitemPolling).toHaveBeenCalledWith('w1', expect.any(Function), 2000);

    const updateCb = (svc.startWorkitemPolling as jest.Mock).mock.calls[0][1];
    act(() => updateCb({ state: 'COMPLETED' }));
    expect(onComplete).toHaveBeenCalled();
    expect(result.current.progress).toBe(100);
    expect(result.current.status).toBe('idle');
    expect(ui.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'success' }));
  });

  it('success without a workitem_uid falls back without polling', async () => {
    const { result, svc } = setup({
      routeSeriesToAI: jest.fn().mockResolvedValue({ status: 'success', message: 'ok' }),
    });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.sendToAI('1.2', ['s1']);
    });
    expect(ok).toBe(true);
    expect(result.current.progress).toBe(50);
    expect(svc.startWorkitemPolling).not.toHaveBeenCalled();
  });

  it('an error-status response sets the error and shows an error toast', async () => {
    const { result, ui } = setup({
      routeSeriesToAI: jest.fn().mockResolvedValue({ status: 'error', message: 'backend down' }),
    });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.sendToAI('1.2', ['s1']);
    });
    expect(ok).toBe(false);
    expect(result.current.error).toBe('backend down');
    expect(ui.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('a thrown routeSeriesToAI rejection is caught and surfaced', async () => {
    const { result } = setup({
      routeSeriesToAI: jest.fn().mockRejectedValue(new Error('boom')),
    });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.sendToAI('1.2', ['s1']);
    });
    expect(ok).toBe(false);
    expect(result.current.error).toBe('boom');
    expect(result.current.status).toBe('idle');
  });

  it('a SCHEDULED then IN_PROGRESS update advances status/progress', async () => {
    const { result, svc } = setup();
    await act(async () => {
      await result.current.sendToAI('1.2', ['s1']);
    });
    const updateCb = (svc.startWorkitemPolling as jest.Mock).mock.calls[0][1];

    act(() => updateCb({ state: 'SCHEDULED' }));
    expect(result.current.status).toBe('routing');
    expect(result.current.progress).toBe(10);

    act(() => updateCb({ state: 'IN_PROGRESS', progress: 60, progressDescription: 'analyzing' }));
    expect(result.current.status).toBe('checking');
    expect(result.current.progress).toBe(60);
    expect(result.current.progressDescription).toBe('analyzing');
  });

  it('a CANCELED update sets the error from the cancellation reason', async () => {
    const { result, svc } = setup();
    await act(async () => {
      await result.current.sendToAI('1.2', ['s1']);
    });
    const updateCb = (svc.startWorkitemPolling as jest.Mock).mock.calls[0][1];
    act(() => updateCb({ state: 'CANCELED', cancellationReason: 'operator stopped' }));
    expect(result.current.error).toBe('operator stopped');
  });

  it('reset stops polling and clears state', async () => {
    const { result, svc } = setup();
    await act(async () => {
      await result.current.sendToAI('1.2', ['s1']);
    });
    act(() => result.current.reset());
    expect(svc.stopWorkitemPolling).toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
    expect(result.current.progress).toBe(0);
    expect(result.current.workitemUid).toBeNull();
  });
});
