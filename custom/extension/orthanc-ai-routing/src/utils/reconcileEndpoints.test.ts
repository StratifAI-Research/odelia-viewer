import { reconcileEndpoints } from './reconcileEndpoints';
import type { AIEndpoint } from '../components/AIEndpointConfig';

const ep = (id: string, name = id, url = `http://${id}`): AIEndpoint => ({ id, name, url });

describe('reconcileEndpoints', () => {
  it('adopts config wholesale when nothing is stored', () => {
    expect(reconcileEndpoints({ stored: [], config: [ep('a')], base: null })).toEqual([ep('a')]);
  });

  it('returns an empty list when neither side has anything', () => {
    expect(reconcileEndpoints({ stored: [], config: [], base: null })).toEqual([]);
  });

  // The regression this whole merge exists for: before it, a stored list won
  // outright and a deployment could never change an endpoint again.
  it('applies a URL change made in config', () => {
    const merged = reconcileEndpoints({
      stored: [ep('a', 'A', 'http://old')],
      config: [ep('a', 'A', 'http://new')],
      base: [ep('a', 'A', 'http://old')],
    });
    expect(merged).toEqual([ep('a', 'A', 'http://new')]);
  });

  it('applies a rename made in config', () => {
    const merged = reconcileEndpoints({
      stored: [ep('a', 'Old name', 'http://a')],
      config: [ep('a', 'New name', 'http://a')],
      base: [ep('a', 'Old name', 'http://a')],
    });
    expect(merged[0].name).toBe('New name');
  });

  it('adds an endpoint newly declared in config', () => {
    const merged = reconcileEndpoints({
      stored: [ep('a')],
      config: [ep('a'), ep('b')],
      base: [ep('a')],
    });
    expect(merged.map(e => e.id)).toEqual(['a', 'b']);
  });

  it('removes an endpoint the deployment dropped from config', () => {
    const merged = reconcileEndpoints({
      stored: [ep('a'), ep('b')],
      config: [ep('a')],
      base: [ep('a'), ep('b')],
    });
    expect(merged.map(e => e.id)).toEqual(['a']);
  });

  it('keeps an endpoint the user added by hand', () => {
    const merged = reconcileEndpoints({
      stored: [ep('a'), ep('mine')],
      config: [ep('a')],
      base: [ep('a')],
    });
    expect(merged.map(e => e.id)).toEqual(['a', 'mine']);
  });

  // The reason a base snapshot is kept at all: without it, "stored differs from
  // config" is ambiguous and a user edit is indistinguishable from a config change.
  it('preserves a user edit to a config endpoint that config has not changed', () => {
    const merged = reconcileEndpoints({
      stored: [ep('a', 'A', 'http://user-edited')],
      config: [ep('a', 'A', 'http://original')],
      base: [ep('a', 'A', 'http://original')],
    });
    expect(merged).toEqual([ep('a', 'A', 'http://user-edited')]);
  });

  it('lets a later config change override an earlier user edit', () => {
    const merged = reconcileEndpoints({
      stored: [ep('a', 'A', 'http://user-edited')],
      config: [ep('a', 'A', 'http://config-v2')],
      base: [ep('a', 'A', 'http://config-v1')],
    });
    expect(merged).toEqual([ep('a', 'A', 'http://config-v2')]);
  });

  it('orders config endpoints first, then user-added ones', () => {
    const merged = reconcileEndpoints({
      stored: [ep('mine'), ep('b'), ep('a')],
      config: [ep('a'), ep('b')],
      base: [ep('a'), ep('b')],
    });
    expect(merged.map(e => e.id)).toEqual(['a', 'b', 'mine']);
  });

  describe('first run with no base recorded', () => {
    // A browser that stored its list before this merge existed. A difference
    // cannot be attributed to either side, so nothing already present is
    // touched — only genuinely new config entries are adopted.
    it('leaves an existing entry alone rather than assuming config changed', () => {
      const merged = reconcileEndpoints({
        stored: [ep('a', 'A', 'http://stored')],
        config: [ep('a', 'A', 'http://config')],
        base: null,
      });
      expect(merged).toEqual([ep('a', 'A', 'http://stored')]);
    });

    it('still adopts an endpoint the browser has never seen', () => {
      const merged = reconcileEndpoints({
        stored: [ep('a')],
        config: [ep('a'), ep('new')],
        base: null,
      });
      expect(merged.map(e => e.id)).toEqual(['a', 'new']);
    });

    it('does not remove a stored endpoint absent from config', () => {
      const merged = reconcileEndpoints({
        stored: [ep('a'), ep('unknown')],
        config: [ep('a')],
        base: null,
      });
      expect(merged.map(e => e.id)).toEqual(['a', 'unknown']);
    });
  });
});
