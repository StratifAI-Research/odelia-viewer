import { useCallback, useEffect, useState } from 'react';
import { cache, Enums } from '@cornerstonejs/core';

/** Which images the active viewport shows, and where in them it sits. */
export interface ViewerSlice {
  /**
   * OHIF's identity for the displayed images, not the SeriesInstanceUID: a series
   * can be split across several display sets, and only one of them is on screen.
   */
  displaySetInstanceUID: string | null;
  /**
   * 1-based position on the axis the viewport scrolls. On a 4D series this is the
   * anatomical slice within the current phase — "16" of the viewer's "16/31" —
   * not an index into the series' instances.
   */
  sliceNumber: number | null;
  /**
   * 1-based contrast phase on screen, for a 4D series. Null when the viewport is
   * not showing a dynamic volume, or cornerstone will not say.
   *
   * The slice number alone is ambiguous on a dynamic study: "slice 16" is 16 of
   * 31 in *some* phase and does not say which, and the same anatomy pre- and
   * post-contrast are different findings.
   */
  phaseNumber: number | null;
}

const NO_SLICE: ViewerSlice = {
  displaySetInstanceUID: null,
  sliceNumber: null,
  phaseNumber: null,
};

interface ViewerSliceConfig {
  activeViewportId: string | null;
  viewports: Map<string, any> | null | undefined;
  servicesManager: any;
}

/**
 * The slice currently on screen in the active viewport.
 *
 * The chat panel uses this two ways. While the context follows the viewer it is
 * the selection: the series attached and the range sent are what is on screen.
 * Once pinned it is only a marker on the slice-range slider, showing where the
 * reader is relative to what the prompt will send — orientation, not selection,
 * so scrolling cannot rewrite a question mid-compose.
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

    // Which images are on screen comes from the grid, which knows it as soon as
    // the layout is set. Where in them the viewport sits comes from cornerstone,
    // which does not know until it has built a viewport. Reported separately
    // rather than as all-or-nothing: a viewport still initialising has a display
    // set and no slice, and collapsing that to "nothing on screen" would leave
    // the panel with nothing attached until cornerstone caught up.
    const displaySetInstanceUID =
      viewports?.get(activeViewportId)?.displaySetInstanceUIDs?.[0] ?? null;

    const cornerstoneViewportService = servicesManager?.services?.cornerstoneViewportService;
    const viewport = cornerstoneViewportService?.getCornerstoneViewport?.(activeViewportId);
    if (!viewport?.getCurrentImageIdIndex) {
      return { displaySetInstanceUID, sliceNumber: null, phaseNumber: null };
    }

    // The phase comes off the volume, not the viewport.
    //
    // Deliberately NOT `viewport.getCurrentImageId()`, which is the obvious way
    // to name the image on screen and is wrong here: measured against the running
    // viewer on the UKA dynamic series, with the viewport on "I:116 (24/31)" it
    // returned the instance for slice 8. `getCurrentImageIdIndex()` matched the
    // overlay at every position tested, and the dynamic volume tracks its own
    // phase in `dimensionGroupNumber` (1-based; older cornerstone called this
    // `timePointIndex`).
    let phaseNumber: number | null = null;
    try {
      const volumeIds: string[] = viewport.getAllVolumeIds?.() ?? [];
      const volume = volumeIds.length > 0 ? (cache?.getVolume?.(volumeIds[0]) as any) : null;
      const group = volume?.dimensionGroupNumber;
      phaseNumber = Number.isFinite(group) && group > 0 ? group : null;
    } catch (_) {
      // Not a volume viewport, or a volume mid-load. A missing phase is reported
      // as unknown, never guessed as 1.
      phaseNumber = null;
    }

    let index: number;
    try {
      index = viewport.getCurrentImageIdIndex();
    } catch (_) {
      // A viewport mid-teardown throws rather than returning a stale index.
      return { displaySetInstanceUID, sliceNumber: null, phaseNumber };
    }

    if (!Number.isFinite(index) || index < 0) {
      return { displaySetInstanceUID, sliceNumber: null, phaseNumber };
    }
    return { displaySetInstanceUID, sliceNumber: index + 1, phaseNumber };
  }, [activeViewportId, viewports, servicesManager]);

  useEffect(() => {
    const sync = () => {
      const next = read();
      // Compared field by field: this fires on every scroll step, and a fresh
      // object identity each time would re-render the whole panel per slice.
      setSlice(prev =>
        prev.displaySetInstanceUID === next.displaySetInstanceUID &&
        prev.sliceNumber === next.sliceNumber &&
        prev.phaseNumber === next.phaseNumber
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
