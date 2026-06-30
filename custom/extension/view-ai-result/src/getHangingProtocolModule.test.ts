import getHangingProtocolModule from './getHangingProtocolModule';
import hpSinglePrimary from './hangingProtocols/hpSinglePrimary';

describe('getHangingProtocolModule', () => {
  it('registers exactly one protocol entry', () => {
    const entries = getHangingProtocolModule();
    expect(Array.isArray(entries)).toBe(true);
    expect(entries).toHaveLength(1);
  });

  it('keys the entry name by the protocol id', () => {
    const [entry] = getHangingProtocolModule();
    expect(entry.name).toBe(hpSinglePrimary.id);
    expect(entry.name).toBe('@ohif/extension-view-ai-result.hpSinglePrimary');
  });

  it('exposes the exported hpSinglePrimary protocol object', () => {
    const [entry] = getHangingProtocolModule();
    expect(entry.protocol).toBe(hpSinglePrimary);
  });
});
