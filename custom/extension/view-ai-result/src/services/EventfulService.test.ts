import { EventfulService } from './EventfulService';

type Evt = 'a' | 'b';

/** Exposes the protected members so the base can be tested on its own. */
class Probe extends EventfulService<Evt> {
  emit(event: Evt, data: unknown) {
    this.publish(event, data);
  }
  clear() {
    this.clearListeners();
  }
}

describe('EventfulService', () => {
  let service: Probe;

  beforeEach(() => {
    service = new Probe();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('delivers to every subscriber of the event', () => {
    const first = jest.fn();
    const second = jest.fn();
    service.subscribe('a', first);
    service.subscribe('a', second);

    service.emit('a', { n: 1 });

    expect(first).toHaveBeenCalledWith({ n: 1 });
    expect(second).toHaveBeenCalledWith({ n: 1 });
  });

  it('does not deliver across event names', () => {
    const listener = jest.fn();
    service.subscribe('a', listener);
    service.emit('b', {});
    expect(listener).not.toHaveBeenCalled();
  });

  it('is a no-op when nobody is listening', () => {
    expect(() => service.emit('a', {})).not.toThrow();
  });

  it('stops delivering after unsubscribe', () => {
    const listener = jest.fn();
    const { unsubscribe } = service.subscribe('a', listener);
    unsubscribe();
    service.emit('a', {});
    expect(listener).not.toHaveBeenCalled();
  });

  it('unsubscribing twice does not disturb other listeners', () => {
    const other = jest.fn();
    const { unsubscribe } = service.subscribe('a', jest.fn());
    service.subscribe('a', other);
    unsubscribe();
    unsubscribe();
    service.emit('a', {});
    expect(other).toHaveBeenCalledTimes(1);
  });

  // Both services are consumed by React panels; one throwing subscriber must not
  // starve the rest. This is why these services do not use PubSubService, whose
  // _broadcastEvent has no try/catch.
  it('isolates a throwing subscriber from the others', () => {
    const after = jest.fn();
    service.subscribe('a', () => {
      throw new Error('boom');
    });
    service.subscribe('a', after);

    expect(() => service.emit('a', {})).not.toThrow();
    expect(after).toHaveBeenCalledTimes(1);
  });

  // The previous hand-rolled copies iterated the live array, so a listener that
  // unsubscribed during delivery shifted the array and the next one was skipped.
  it('still notifies later subscribers when one unsubscribes mid-publish', () => {
    const last = jest.fn();
    const { unsubscribe } = service.subscribe('a', () => unsubscribe());
    service.subscribe('a', last);

    service.emit('a', {});

    expect(last).toHaveBeenCalledTimes(1);
  });

  it('clearListeners drops every subscription', () => {
    const listener = jest.fn();
    service.subscribe('a', listener);
    service.clear();
    service.emit('a', {});
    expect(listener).not.toHaveBeenCalled();
  });
});
