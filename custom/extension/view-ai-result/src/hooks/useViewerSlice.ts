import { useCallback, useEffect, useState } from 'react';
import { Enums, eventTarget } from '@cornerstonejs/core';

/** Which series the active viewport shows, and which slice of it. */
export interface ViewerSlice {
  seriesInstanceUID: string | null;
  /** 1-based, matching the slice numbers the panel displays. Null if unknown. */
  sliceNumber: number | null;
}

const NO_SLICE: ViewerSlice = { seriesInstanceUID: null, sliceNumber: null };

interface ViewerSliceConfig {
  activeViewportId: string | null;
  viewports: Map<string, any> | null | undefined;
  servicesManager: any;
}

/**
 * The slice currently on screen in the active viewport.
 *
 * The chat panel draws it as a marker on the slice-range slider, so the reader
 * can see where they are relative to what the prompt will send. It is
 * deliberately *not* used to choose slices: a marker that follows the viewport is
 * orientation, whereas a selection that follows the viewport would change the
 * question under the user.
 *
 * Read from cornerstone rather than from the viewport grid because the grid
 * carries no scroll position — scrolling a stack changes nothing the grid
 * publishes. Hence the event subscription: STACK_NEW_IMAGE for stack viewports,
 * VOLUME_NEW_IMAGE for volume ones.
 */
export function useViewerSlice({
  activeViewportId,
  viewports,
  servicesManager,
}: ViewerSliceConfig): ViewerSlice {
  const [slice, setSlice] = useState<ViewerSlice>(NO_SLICE);

  const read = useCallback((): ViewerSlice => {
    if (!activeViewportId) {
      return NO_SLICE;
    }

    const cornerstoneViewportService = servicesManager?.services?.cornerstoneViewportService;
    const displaySetService = servicesManager?.services?.displaySetService;
    const viewport = cornerstoneViewportService?.getCornerstoneViewport?.(activeViewportId);
    if (!viewport?.getCurrentImageIdIndex) {
      return NO_SLICE;
    }

    // The series the viewport is showing. Taken from the grid's display set
    // rather than by parsing the imageId, which is loader-specific.
    const displaySetUID = viewports?.get(activeViewportId)?.displaySetInstanceUIDs?.[0];
    const displaySet = displaySetUID
      ? displaySetService?.getDisplaySetByUID?.(displaySetUID)
      : undefined;
    const seriesInstanceUID = displaySet?.SeriesInstanceUID ?? null;

    let index: number;
    try {
      index = viewport.getCurrentImageIdIndex();
    } catch (_) {
      // A viewport mid-teardown throws rather than returning a stale index.
      return { seriesInstanceUID, sliceNumber: null };
    }

    if (!Number.isFinite(index) || index < 0) {
      return { seriesInstanceUID, sliceNumber: null };
    }
    return { seriesInstanceUID, sliceNumber: index + 1 };
  }, [activeViewportId, viewports, servicesManager]);

  useEffect(() => {
    const sync = () => {
      const next = read();
      // Compared field by field: this fires on every scroll step, and a fresh
      // object identity each time would re-render the whole panel per slice.
      setSlice(prev =>
        prev.seriesInstanceUID === next.seriesInstanceUID && prev.sliceNumber === next.sliceNumber
          ? prev
          : next
      );
    };

    sync();

    const events = [Enums?.Events?.STACK_NEW_IMAGE, Enums?.Events?.VOLUME_NEW_IMAGE].filter(
      Boolean
    ) as string[];
    if (!eventTarget?.addEventListener || events.length === 0) {
      return;
    }
    events.forEach(evt => eventTarget.addEventListener(evt, sync));
    return () => events.forEach(evt => eventTarget.removeEventListener(evt, sync));
  }, [read]);

  return slice;
}
