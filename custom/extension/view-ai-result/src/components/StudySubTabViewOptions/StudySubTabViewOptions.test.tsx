// StudySubTabViewOptions.tsx is an empty placeholder (0 bytes) with no exports
// and no references anywhere in the extension. There is no component to render,
// so this guards that the module stays empty — flag if a component is added here.
import * as StudySubTabViewOptions from './StudySubTabViewOptions';

describe('StudySubTabViewOptions', () => {
  it('declares no real exports (empty placeholder module)', () => {
    // Empty module: only a synthesized, empty `default` under interop, no named exports.
    const named = Object.keys(StudySubTabViewOptions).filter(k => k !== 'default');
    expect(named).toHaveLength(0);
    expect(Object.keys((StudySubTabViewOptions as any).default ?? {})).toHaveLength(0);
  });
});
