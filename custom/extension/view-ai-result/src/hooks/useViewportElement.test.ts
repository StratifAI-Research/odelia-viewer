import { renderHook, act } from '@testing-library/react';
import { useViewportElement } from './useViewportElement';

describe('useViewportElement', () => {
  it('returns null element initially', () => {
    const { result } = renderHook(() => useViewportElement());
    expect(result.current.viewportElem).toBeNull();
  });

  it('sets the element from the enabled event detail', () => {
    const { result } = renderHook(() => useViewportElement());
    const element = { id: 'el1' };
    act(() => {
      result.current.onElementEnabled({ detail: { element } });
    });
    expect(result.current.viewportElem).toBe(element);
  });

  it('clears the element on disabled', () => {
    const { result } = renderHook(() => useViewportElement());
    const element = { id: 'el1' };
    act(() => {
      result.current.onElementEnabled({ detail: { element } });
    });
    expect(result.current.viewportElem).toBe(element);
    act(() => {
      result.current.onElementDisabled();
    });
    expect(result.current.viewportElem).toBeNull();
  });

  it('does not change state when the same element is re-enabled', () => {
    const { result } = renderHook(() => useViewportElement());
    const element = { id: 'el1' };
    act(() => {
      result.current.onElementEnabled({ detail: { element } });
    });
    const first = result.current.viewportElem;
    act(() => {
      result.current.onElementEnabled({ detail: { element } });
    });
    expect(result.current.viewportElem).toBe(first);
  });
});
