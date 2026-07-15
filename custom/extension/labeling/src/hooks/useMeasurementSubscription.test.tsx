import { renderHook, act } from '@testing-library/react';
import { useMeasurementSubscription } from './useMeasurementSubscription';

function makeService() {
  const unsubscribe = jest.fn();
  const subscribe = jest.fn((_evt: string, _cb: () => void) => ({ unsubscribe }));
  return {
    EVENTS: {
      MEASUREMENT_ADDED: 'added',
      RAW_MEASUREMENT_ADDED: 'addedRaw',
      MEASUREMENT_UPDATED: 'updated',
      MEASUREMENT_REMOVED: 'removed',
      MEASUREMENTS_CLEARED: 'cleared',
    },
    subscribe,
    unsubscribe,
  };
}

describe('useMeasurementSubscription', () => {
  it('maps measurements initially and subscribes to all five events', () => {
    const service = makeService();
    const getMapped = jest.fn(() => [{ uid: 'm1' }]);
    const { result } = renderHook(() => useMeasurementSubscription(service, getMapped));

    expect(result.current[0]).toEqual([{ uid: 'm1' }]);
    expect(getMapped).toHaveBeenCalledWith(service);
    expect(service.subscribe).toHaveBeenCalledTimes(5);
    const events = service.subscribe.mock.calls.map(c => c[0]);
    expect(events).toEqual(['added', 'addedRaw', 'updated', 'removed', 'cleared']);
  });

  it('unsubscribes from every event on unmount', () => {
    const service = makeService();
    const { unmount } = renderHook(() => useMeasurementSubscription(service, () => []));
    unmount();
    expect(service.unsubscribe).toHaveBeenCalledTimes(5);
  });

  it('exposes a setter that updates the snapshot', () => {
    const service = makeService();
    const { result } = renderHook(() => useMeasurementSubscription(service, () => []));
    act(() => {
      result.current[1]([{ uid: 'x' }]);
    });
    expect(result.current[0]).toEqual([{ uid: 'x' }]);
  });
});
