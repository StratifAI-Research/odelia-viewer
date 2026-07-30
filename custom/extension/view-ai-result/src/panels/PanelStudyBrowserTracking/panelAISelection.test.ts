import { isAIResultModality, resolveInitialSelectedSRUID } from './panelAISelection';

describe('isAIResultModality', () => {
  it('is true for SR and SC only', () => {
    expect(isAIResultModality('SR')).toBe(true);
    expect(isAIResultModality('SC')).toBe(true);
    expect(isAIResultModality('MR')).toBe(false);
    expect(isAIResultModality(undefined)).toBe(false);
  });
});

describe('resolveInitialSelectedSRUID', () => {
  const sm = {} as any;

  it('returns null when there are no studies or no service', () => {
    expect(resolveInitialSelectedSRUID([], {}, sm)).toBeNull();
    expect(resolveInitialSelectedSRUID(['s1'], null, sm)).toBeNull();
  });

  it('returns the selected SR UID from the metadata helper', () => {
    const svc = {
      getSelectedAIResult: jest.fn(() => ({ id: 'r' })),
      getAIResultMetadata: jest.fn(() => [
        { displaySetInstanceUID: 'sr-1', isSelected: false },
        { displaySetInstanceUID: 'sr-2', isSelected: true },
      ]),
    };
    expect(resolveInitialSelectedSRUID(['study-1'], svc, sm)).toBe('sr-2');
  });

  it('skips studies with no selection and returns the first hit found', () => {
    const svc = {
      getSelectedAIResult: jest
        .fn()
        .mockReturnValueOnce(null) // study-1: nothing selected
        .mockReturnValueOnce({ id: 'r' }), // study-2: selected
      getAIResultMetadata: jest.fn(() => [{ displaySetInstanceUID: 'sr-9', isSelected: true }]),
    };
    expect(resolveInitialSelectedSRUID(['study-1', 'study-2'], svc, sm)).toBe('sr-9');
    expect(svc.getAIResultMetadata).toHaveBeenCalledTimes(1); // only for study-2
  });

  it('returns null when a result is selected but no metadata entry is flagged', () => {
    const svc = {
      getSelectedAIResult: jest.fn(() => ({ id: 'r' })),
      getAIResultMetadata: jest.fn(() => [{ displaySetInstanceUID: 'sr-1', isSelected: false }]),
    };
    expect(resolveInitialSelectedSRUID(['study-1'], svc, sm)).toBeNull();
  });
});
