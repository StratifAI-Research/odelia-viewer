import { useCallback, useEffect, useState } from 'react';
import { Enums } from '@cornerstonejs/core';

/** Which images the active viewport shows, and which slice of them. */
export interface ViewerSlice {
  /**
   * OHIF's identity for the displayed images, not the SeriesInstanceUID: a series
   * can be split across several display sets, and only one of them is on screen.
   */
  displaySetInstanceUID: string | null;
  /** 1-based, matching the slice numbers the panel displays. Null if unknown. */
  sliceNumber: number | null;
}

const NO_SLICE: ViewerSlice = { displaySetInstanceUID: null, sliceNumber: null };

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
 *
 * Those events are dispatched on the *viewport element*, not on cornerstone's
 * global `eventTarget`. Measured against the running viewer: scrolling a volume
 * viewport eight notches produced eight VOLUME_NEW_IMAGE events on the element
 * and none on `eventTarget`. Subscribing to the global target therefore looked
 * correct, compiled, and never fired once — the marker was painted at mount and
 * stayed there for the rest of the session.
 *
 * The listener goes on `document` in the capture phase rather than on the
 * element itself. A non-bubbling event still runs the capture phase down the
 * ancestor chain, so this hears every viewport, and it does not have to wait for
 * an element that does not exist yet at mount or re-subscribe when the grid
 * swaps viewports. `read()` resolves the active viewport itself, so the event is
 * only a signal that something moved.
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
    const viewport = cornerstoneViewportService?.getCornerstoneViewport?.(activeViewportId);
    if (!viewport?.getCurrentImageIdIndex) {
      return NO_SLICE;
    }

    // What the viewport is showing, taken from the grid rather than by parsing
    // the imageId, which is loader-specific.
    const displaySetInstanceUID =
      viewports?.get(activeViewportId)?.displaySetInstanceUIDs?.[0] ?? null;

    let index: number;
    try {
      index = viewport.getCurrentImageIdIndex();
    } catch (_) {
      // A viewport mid-teardown throws rather than returning a stale index.
      return { displaySetInstanceUID, sliceNumber: null };
    }

    if (!Number.isFinite(index) || index < 0) {
      return { displaySetInstanceUID, sliceNumber: null };
    }
    return { displaySetInstanceUID, sliceNumber: index + 1 };
  }, [activeViewportId, viewports, servicesManager]);

  useEffect(() => {
    const sync = () => {
      const next = read();
      // Compared field by field: this fires on every scroll step, and a fresh
      // object identity each time would re-render the whole panel per slice.
      setSlice(prev =>
        prev.displaySetInstanceUID === next.displaySetInstanceUID &&
        prev.sliceNumber === next.sliceNumber
          ? prev
          : next
      );
    };

    sync();

    const events = [Enums?.Events?.STACK_NEW_IMAGE, Enums?.Events?.VOLUME_NEW_IMAGE].filter(
      Boolean
    ) as string[];
    if (typeof document === 'undefined' || events.length === 0) {
      return;
    }
    events.forEach(evt => document.addEventListener(evt, sync, true));
    return () => events.forEach(evt => document.removeEventListener(evt, sync, true));
  }, [read]);

  return slice;
}
