import { useCallback, useEffect, useState } from 'react';
import { cache, Enums, utilities as csUtils } from '@cornerstonejs/core';

/** Which images the active viewport shows, and where in them it sits. */
export interface ViewerSlice {
  /**
   * OHIF's identity for the displayed images, not the SeriesInstanceUID: a series
   * can be split across several display sets, and only one of them is on screen.
   */
  displaySetInstanceUID: string | null;
  /**
   * 1-based position on the axis the viewport scrolls. On a 4D series this is the
   * anatomical slice within the current dimension group — "16" of the viewer's "16/31" —
   * not an index into the series' instances.
   *
   * Only comparable with a display set's own slice axis while
   * `scrollsAcquisitionAxis` holds. A volume viewport counts steps along whatever
   * its camera is looking down, so a reoriented one counts along a different axis
   * of a different length.
   */
  sliceNumber: number | null;
  /**
   * Whether the viewport is scrolling the axis the images were acquired on --
   * the one a display set's `sliceAxis` is expressed in.
   *
   * False once the reader picks sagittal or coronal from the viewport's
   * orientation menu, which OHIF offers on any reconstructable series. Null when
   * there is nothing to compare, and treated as "yes" by callers: a stack
   * viewport has one axis and it is this one.
   *
   * `getNumberOfSlices` is carried with it because the plane test is
   * sign-insensitive, and because a count that disagrees with the axis proves a
   * mismatch whatever the plane test says.
   */
  scrollsAcquisitionAxis: boolean | null;
  /** How many positions the viewport scrolls through, or null if it cannot say. */
  viewportSliceCount: number | null;
  /**
   * 1-based dimension group on screen, for a 4D series. Null when the viewport is
   * not showing a dynamic volume, or cornerstone will not say.
   *
   * The slice number alone is ambiguous on a dynamic study: "slice 16" is 16 of
   * 31 in *some* group and does not say which, and the same anatomy pre- and
   * post-contrast are different findings.
   */
  dimensionGroupNumber: number | null;
  /**
   * The grey-level window the viewport is displaying with, in the volume's own
   * units, or null while the viewport cannot report one.
   *
   * Sent with a message so the model sees what the reader sees. Without it the
   * middleware auto-windows each slice on its own percentiles, which makes the
   * reader's window — a clinical decision — have no effect on what is sent.
   */
  voi: { lower: number; upper: number; invert: boolean } | null;
}

const NO_SLICE: ViewerSlice = {
  displaySetInstanceUID: null,
  sliceNumber: null,
  scrollsAcquisitionAxis: null,
  viewportSliceCount: null,
  dimensionGroupNumber: null,
  voi: null,
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
      return {
        displaySetInstanceUID,
        sliceNumber: null,
        scrollsAcquisitionAxis: null,
        viewportSliceCount: null,
        dimensionGroupNumber: null,
        voi: null,
      };
    }

    // Whether the viewport is scrolling the axis the images were acquired on.
    //
    // A volume viewport counts steps along whatever its camera looks down, so a
    // reader who picks sagittal from the viewport menu -- OHIF offers it on any
    // reconstructable series, and a dynamic study is silently upgraded to a
    // volume viewport to be shown at all -- gets an index on a different axis of
    // a different length. Read against a 31-slice acquisition axis, step 250 of a
    // sagittal reformat is not slice 250 of anything.
    //
    // Asked as a signed question, not `isInAcquisitionPlane()`: that answers
    // about the plane and not the direction, so it also passes a volume being
    // looked at from the other side, where the index runs backwards and every
    // slice number is wrong by more than the reformat case. The dot product of
    // the camera normal with the acquisition normal answers both at once.
    //
    // The step count is carried alongside it because a length that cannot be the
    // acquisition axis proves a mismatch whatever the geometry said, and because
    // it is the one signal available when the volume cannot be read.
    //
    // None of this proves a match -- that would mean replicating cornerstone's
    // projections -- and it does not have to. It only has to stop the panel
    // claiming one.
    let scrollsAcquisitionAxis: boolean | null = null;
    try {
      const volumeIds: string[] = viewport.getAllVolumeIds?.() ?? [];
      const volume = volumeIds.length > 0 ? (cache?.getVolume?.(volumeIds[0]) as any) : null;
      const cameraNormal = viewport.getCamera?.()?.viewPlaneNormal;
      if (volumeIds.length === 0) {
        // A stack has one axis and it is this one, so there is nothing to check
        // and nothing to get wrong.
        //
        // One exception, and it is not reachable in this deployment: under
        // `?useNextViewports=true` a generic volume viewport filters its actor
        // IDs through the cache, so an uncached volume reports no IDs and is
        // read here as a stack. Those viewports are off by default
        // (platform/app/public/config/default.js), and on that path only the
        // step count would be left guarding.
        scrollsAcquisitionAxis = null;
      } else if (!volume || !volume.direction || cameraNormal?.length !== 3) {
        // A volume viewport whose volume cannot be read. NOT reported as unknown:
        // the step count is no help either, since cornerstone computes that from
        // the same cached volume, so both would go silent together and the panel
        // would follow on nothing at all. A viewport in that state is one whose
        // slice number is not trustworthy either.
        scrollsAcquisitionAxis = false;
      } else {
        const acquisition = csUtils.getAcquisitionPlaneOrientation(volume)?.viewPlaneNormal;
        // Length rather than `Array.isArray`: cornerstone's direction may be a
        // Float32Array, and the helper preserves the container, so an array test
        // would quietly answer "unknown" on exactly the viewports this is for.
        const dot =
          acquisition?.length === 3
            ? acquisition[0] * cameraNormal[0] +
              acquisition[1] * cameraNormal[1] +
              acquisition[2] * cameraNormal[2]
            : null;
        // Both are unit normals, so this is the cosine of the angle between
        // them. Deliberately tighter than cornerstone's own 0.99, which allows
        // 8 degrees: that is the right tolerance for "near enough to render as
        // the acquisition plane" and the wrong one for "this index addresses
        // acquisition slices", which is what is being asked here.
        scrollsAcquisitionAxis = dot === null ? false : dot > 0.9999;
      }
    } catch (_) {
      // A viewport mid-teardown, or a volume not in the cache yet. Unknown
      // rather than "no": treating silence as a mismatch would stop following on
      // every ordinary series.
      scrollsAcquisitionAxis = null;
    }

    let viewportSliceCount: number | null = null;
    try {
      // Probed separately: a camera that could not be read must not discard a
      // count that disagrees.
      const count = viewport.getNumberOfSlices?.();
      viewportSliceCount = Number.isFinite(count) && count > 0 ? count : null;
    } catch (_) {
      viewportSliceCount = null;
    }

    // The window, as `{lower, upper}` in the volume's units. Verified against the
    // running viewer: a viewport whose overlay reads "W:1260 L:725" reports
    // `{lower: 95.1, upper: 1354.1}`, and both track a window/level drag.
    let voi: ViewerSlice['voi'] = null;
    try {
      const properties = viewport.getProperties?.();
      const range = properties?.voiRange;
      const lower = Number(range?.lower);
      const upper = Number(range?.upper);
      if (Number.isFinite(lower) && Number.isFinite(upper) && upper > lower) {
        voi = { lower, upper, invert: Boolean(properties?.invert) };
      }
    } catch (_) {
      // A viewport mid-teardown, or one with no VOI concept. Reported as
      // unknown, which falls back to the middleware's own windowing.
      voi = null;
    }

    // The dimension group comes off the volume, not the viewport.
    //
    // Deliberately NOT `viewport.getCurrentImageId()`, which is the obvious way
    // to name the image on screen and is wrong here: measured against the running
    // viewer on the UKA dynamic series, with the viewport on "I:116 (24/31)" it
    // returned the instance for slice 8. `getCurrentImageIdIndex()` matched the
    // overlay at every position tested, and the dynamic volume tracks its own
    // position on the fourth axis in `dimensionGroupNumber` (1-based; older
    // cornerstone called this `timePointIndex`).
    let dimensionGroupNumber: number | null = null;
    try {
      const volumeIds: string[] = viewport.getAllVolumeIds?.() ?? [];
      const volume = volumeIds.length > 0 ? (cache?.getVolume?.(volumeIds[0]) as any) : null;
      const group = volume?.dimensionGroupNumber;
      dimensionGroupNumber = Number.isFinite(group) && group > 0 ? group : null;
    } catch (_) {
      // Not a volume viewport, or a volume mid-load. A missing group is reported
      // as unknown rather than guessed as 1, so that a caller which has to pick
      // one is at least picking knowingly, and can say so.
      dimensionGroupNumber = null;
    }

    let index: number;
    try {
      index = viewport.getCurrentImageIdIndex();
    } catch (_) {
      // A viewport mid-teardown throws rather than returning a stale index.
      return {
        displaySetInstanceUID,
        sliceNumber: null,
        scrollsAcquisitionAxis,
        viewportSliceCount,
        dimensionGroupNumber,
        voi,
      };
    }

    if (!Number.isFinite(index) || index < 0) {
      return {
        displaySetInstanceUID,
        sliceNumber: null,
        scrollsAcquisitionAxis,
        viewportSliceCount,
        dimensionGroupNumber,
        voi,
      };
    }
    return {
      displaySetInstanceUID,
      sliceNumber: index + 1,
      scrollsAcquisitionAxis,
      viewportSliceCount,
      dimensionGroupNumber,
      voi,
    };
  }, [activeViewportId, viewports, servicesManager]);

  useEffect(() => {
    const sync = () => {
      const next = read();
      // Compared field by field: this fires on every scroll step, and a fresh
      // object identity each time would re-render the whole panel per slice.
      setSlice(prev =>
        prev.displaySetInstanceUID === next.displaySetInstanceUID &&
        prev.sliceNumber === next.sliceNumber &&
        prev.dimensionGroupNumber === next.dimensionGroupNumber &&
        prev.scrollsAcquisitionAxis === next.scrollsAcquisitionAxis &&
        prev.viewportSliceCount === next.viewportSliceCount &&
        prev.voi?.lower === next.voi?.lower &&
        prev.voi?.upper === next.voi?.upper &&
        prev.voi?.invert === next.voi?.invert
          ? prev
          : next
      );
    };

    sync();

    const events = [
      Enums?.Events?.STACK_NEW_IMAGE,
      Enums?.Events?.VOLUME_NEW_IMAGE,
      // Window/level drags. Measured on the running viewer: a drag fired
      // VOI_MODIFIED eleven times on the element and zero times on the global
      // target, same as the slice events.
      Enums?.Events?.VOI_MODIFIED,
      // Reorienting the viewport moves the camera without necessarily changing
      // the slice index, so the new-image events can stay silent through it and
      // the panel would go on claiming to follow an axis it no longer can.
      Enums?.Events?.CAMERA_MODIFIED,
    ].filter(Boolean) as string[];
    if (typeof document === 'undefined' || events.length === 0) {
      return;
    }
    events.forEach(evt => document.addEventListener(evt, sync, true));
    return () => events.forEach(evt => document.removeEventListener(evt, sync, true));
  }, [read]);

  return slice;
}
