// `registerModeToolbar` reaches into a live customizationService; the mode factory is
// only inspected for its static wiring here, so stub it out.
jest.mock('@ohif/mode-basic', () => ({ registerModeToolbar: jest.fn() }), { virtual: true });

import mode from './index';
// Imported across packages by relative path on purpose. Asserting a duplicated literal on
// each side is NOT equivalent: a coordinated rename of the protocol and its own test would
// leave this mode's stale string unnoticed with both suites green. Comparing the consumer
// against the producer is what actually catches that. view-ai-result is not resolvable from
// this package, and getHangingProtocolModule pulls in only the plain protocol object, so a
// relative import is cheaper than a moduleNameMapper.
import getHangingProtocolModule from '../../../extension/view-ai-result/src/getHangingProtocolModule';

describe('send-ai hanging protocol', () => {
  const factory = mode.modeFactory();

  // Undefined is the failure this guards, not a wrong id: HangingProtocolService's
  // setActiveProtocolIds() nulls activeProtocolIds when the mode names no protocol, so
  // run() falls to ProtocolEngine matching and every registered protocol competes. The
  // mode then hangs on whichever rule scores highest rather than on its own choice --
  // and @ohif/hpCompare (weight 1000, needs a prior) and @ohif/hpMammo (150) both
  // outscore hpSinglePrimary's 100 today, so this is not a hypothetical future risk.
  it('names a protocol rather than relying on ProtocolEngine matching', () => {
    expect(typeof factory.hangingProtocol).toBe('string');
    expect(factory.hangingProtocol).toBeTruthy();
  });

  it('names a protocol that view-ai-result actually registers', () => {
    const registered = getHangingProtocolModule().map(entry => entry.name);

    expect(registered).toContain(factory.hangingProtocol);
  });

  it('declares the extension that registers it', () => {
    expect(factory.extensions).toHaveProperty('view-ai-result');
  });
});
