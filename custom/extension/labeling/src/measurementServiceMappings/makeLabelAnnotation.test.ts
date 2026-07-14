// @ohif/core is not resolvable in this package's jest env (it is a webpack external),
// so mock it virtually — makeLabelAnnotation only needs utils.guid().
jest.mock('@ohif/core', () => ({ utils: { guid: () => 'test-guid-123' } }), { virtual: true });

import { makeLabelAnnotation } from './makeLabelAnnotation';

describe('makeLabelAnnotation', () => {
  it('builds an ODELIALabel raw annotation with the given fields', () => {
    const labelData = { finding: 'x', side: 'Left' };
    const ann = makeLabelAnnotation({
      labelData,
      referenceStudyUID: 's1',
      source: 'inited',
    });
    expect(ann).toEqual({
      annotationUID: 'test-guid-123',
      metadata: { source: 'inited' },
      data: { label_data: labelData },
      referenceStudyUID: 's1',
      toolName: 'ODELIALabel',
      displayText: 'displayText',
      type: 'ODELIALabel',
    });
  });

  it('passes the source through (e.g. imported)', () => {
    const ann = makeLabelAnnotation({ labelData: {}, referenceStudyUID: 's2', source: 'imported' });
    expect(ann.metadata.source).toBe('imported');
    expect(ann.referenceStudyUID).toBe('s2');
  });
});
