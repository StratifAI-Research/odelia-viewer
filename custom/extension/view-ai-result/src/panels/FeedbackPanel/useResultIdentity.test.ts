import { toResultKey, resultIdentityString } from './useResultIdentity';

const identity = { modelName: 'BreastNet', modelVersion: '1.2.0', resultTs: '2024-03-15T10:00:00Z' };

describe('toResultKey', () => {
  it('builds a key when every field is present', () => {
    expect(toResultKey('study-1', identity)).toEqual({
      studyUID: 'study-1',
      modelName: 'BreastNet',
      modelVersion: '1.2.0',
      resultTs: '2024-03-15T10:00:00Z',
    });
  });

  it('returns null when any field is missing', () => {
    expect(toResultKey(null, identity)).toBeNull();
    expect(toResultKey('study-1', { ...identity, modelName: undefined })).toBeNull();
    expect(toResultKey('study-1', { ...identity, resultTs: undefined })).toBeNull();
  });
});

describe('resultIdentityString', () => {
  it('includes the reader so a response for the previous reader is rejected', () => {
    const a = resultIdentityString('study-1', identity, 'reader-A');
    const b = resultIdentityString('study-1', identity, 'reader-B');
    // Same result, different reader -> different identity (H-11 user-switch guard).
    expect(a).not.toBe(b);
    expect(a).toContain('reader-A');
  });

  it('changes when the result changes', () => {
    const a = resultIdentityString('study-1', identity, 'reader-A');
    const b = resultIdentityString('study-1', { ...identity, resultTs: 'other' }, 'reader-A');
    expect(a).not.toBe(b);
  });
});
