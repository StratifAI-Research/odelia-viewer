import { useState, useCallback } from 'react';

export const useViewportElement = () => {
  const [viewportElem, setViewportElem] = useState(null);

  const onElementEnabled = useCallback(
    evt => {
      if (evt.detail.element !== viewportElem) {
        setViewportElem(evt.detail.element);
      }
    },
    [viewportElem]
  );

  const onElementDisabled = useCallback(() => {
    setViewportElem(null);
  }, []);

  return {
    viewportElem,
    onElementEnabled,
    onElementDisabled,
  };
};
