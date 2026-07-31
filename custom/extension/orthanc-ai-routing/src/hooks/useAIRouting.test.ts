import { renderHook, act } from '@testing-library/react';
import { useAIRouting } from './useAIRouting';
import { AI_ENDPOINT } from '../test-utils/harness';
import type OrthancAIService from '../services/OrthancAIService';

// Duck-typed stub of the methods useAIRouting actually calls. A missing stub
// fails loudly at runtime (calling undefined), so this is a documentation aid,
// not a compile-time drift guard.
type _MockService = Pick<
  OrthancAIService,
  | 'getCurrentEndpoint'
  | 'setCurrentEndpoint'
  | 'routeSeriesToAI'
  | 'startWorkitemPolling'
  | 'stopWorkitemPolling'
>;

function makeService(over: Record<string, any> = {}) {
  return {
    getCurrentEndpoint: jest.fn(() => AI_ENDPOINT),
    setCurrentEndpoint: jest.fn(),
    routeSeriesToAI: jest
      .fn()
      .mockResolvedValue({ status: 'success', workitem_uid: 'w1', message: 'ok' }),
    startWorkitemPolling: jest.fn(),
    stopWorkitemPolling: jest.fn(),
    ...over,
  };
}

function setup(over: Record<string, any> = {}, onComplete?: () => void) {
  const svc = makeService(over);
  const ui = { show: jest.fn() };
  const hook = renderHook(() =>
    useAIRouting({
      orthancAIService: svc as unknown as OrthancAIService,
      uiNotificationService: ui,
      onComplete,
    })
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

  // KNOWN BUG (ODV-160): the hook loads currentEndpoint via a useState lazy
  // initializer (a mount-only side effect), so it never re-reads the service if
  // the prop changes. Unskip once converted to a useEffect keyed on the service.
  it.skip('re-derives currentEndpoint when the orthancAIService prop changes', () => {
    const ui = { show: jest.fn() };
    const { result, rerender } = renderHook(
      ({ s }) =>
        useAIRouting({
          orthancAIService: s as unknown as OrthancAIService,
          uiNotificationService: ui,
        }),
      { initialProps: { s: makeService({ getCurrentEndpoint: jest.fn(() => AI_ENDPOINT) }) } }
    );
    expect(result.current.currentEndpoint).toEqual(AI_ENDPOINT);

    const next = { id: 'ep-2', name: 'other', url: 'http://other' };
    rerender({ s: makeService({ getCurrentEndpoint: jest.fn(() => next) }) });
    expect(result.current.currentEndpoint).toEqual(next); // fails today: mount-hack won't re-run
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
    expect(result.current.status).toBe('idle');
    expect(result.current.progressDescription).toBeNull();
    expect(ui.show).toHaveBeenCalledWith(expect.objectContaining({ type: 'error' }));
  });

  it('an unrecognized response status returns false and resets to idle without an error', async () => {
    const { result } = setup({
      routeSeriesToAI: jest.fn().mockResolvedValue({ status: 'pending' }),
    });
    let ok: boolean | undefined;
    await act(async () => {
      ok = await result.current.sendToAI('1.2', ['s1']);
    });
    expect(ok).toBe(false);
    expect(result.current.status).toBe('idle');
    expect(result.current.progressDescription).toBeNull();
    expect(result.current.error).toBeNull(); // distinct from the 'error' status path
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
    expect(result.current.progress).toBe(0); // progress reset in the catch
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

    // IN_PROGRESS without a description falls back to the default text
    act(() => updateCb({ state: 'IN_PROGRESS', progress: 70 }));
    expect(result.current.progressDescription).toBe('AI analysis in progress...');
    expect(result.current.progress).toBe(70);
  });

  it('an unknown workitem state logs a warning and leaves status unchanged', async () => {
    const { result, svc } = setup();
    await act(async () => {
      await result.current.sendToAI('1.2', ['s1']);
    });
    const updateCb = (svc.startWorkitemPolling as jest.Mock).mock.calls[0][1];
    const warnSpy = jest.spyOn(console, 'warn');
    act(() => updateCb({ state: 'BOGUS_STATE' }));
    expect(warnSpy).toHaveBeenCalledWith('Unknown workitem state:', 'BOGUS_STATE');
    expect(result.current.status).toBe('checking'); // unchanged from post-send state
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

  it('reset stops polling and clears all state fields', async () => {
    const { result, svc } = setup();
    await act(async () => {
      await result.current.sendToAI('1.2', ['s1']);
    });
    expect(result.current.progressDescription).not.toBeNull(); // set by the send

    act(() => result.current.reset());
    expect(svc.stopWorkitemPolling).toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
    expect(result.current.progress).toBe(0);
    expect(result.current.workitemUid).toBeNull();
    expect(result.current.error).toBeNull();
    expect(result.current.progressDescription).toBeNull();
  });

  it('reset clears a previously set error', async () => {
    const { result } = setup();
    await act(async () => {
      await result.current.sendToAI('1.2', []); // empty series → sets error
    });
    expect(result.current.error).not.toBeNull();
    act(() => result.current.reset());
    expect(result.current.error).toBeNull();
  });
});
