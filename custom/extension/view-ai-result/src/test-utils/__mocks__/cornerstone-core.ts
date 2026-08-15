export const Enums = {
  ViewportType: { ORTHOGRAPHIC: 'ORTHOGRAPHIC', STACK: 'STACK' },
  OrientationAxis: { AXIAL: 'AXIAL' },
  Events: { STACK_NEW_IMAGE: 'STACK_NEW_IMAGE', VOLUME_NEW_IMAGE: 'VOLUME_NEW_IMAGE' },
};
// Minimal EventTarget stand-in for the handful of cornerstone events that really
// are dispatched on the global target.
//
// Slice-change events are NOT among them: cornerstone fires STACK_NEW_IMAGE and
// VOLUME_NEW_IMAGE on the viewport *element*. An earlier version of this mock let
// `dispatch('STACK_NEW_IMAGE')` drive `useViewerSlice`, which made a hook that
// never fired in the real viewer look correct in tests. Use `dispatchOnViewport`
// for those, so a test exercises the path the browser actually takes.
export const eventTarget = {
  listeners: {} as Record<string, Array<(evt?: any) => void>>,
  addEventListener(type: string, cb: (evt?: any) => void) {
    (this.listeners[type] ||= []).push(cb);
  },
  removeEventListener(type: string, cb: (evt?: any) => void) {
    this.listeners[type] = (this.listeners[type] || []).filter(l => l !== cb);
  },
  dispatch(type: string, detail?: any) {
    (this.listeners[type] || []).forEach(cb => cb({ type, detail }));
  },
  reset() {
    this.listeners = {};
  },
};
/**
 * Fire a cornerstone viewport event the way cornerstone does: a non-bubbling
 * CustomEvent on an element inside the document. Listeners registered in the
 * capture phase on an ancestor still receive it; listeners on the global
 * `eventTarget` do not.
 */
export const dispatchOnViewport = (type: string, detail?: any) => {
  const element = document.createElement('div');
  document.body.appendChild(element);
  element.dispatchEvent(new CustomEvent(type, { detail, bubbles: false, cancelable: true }));
  element.remove();
};

export const getRenderingEngine = jest.fn(() => undefined);
// Per-module metadata a test can seed, so the ROI capture path can be exercised
// with a real image size and instance identity.
export const __metaData: Record<string, Record<string, any>> = {};
export const __setMetaData = (module: string, imageId: string, value: any) => {
  (__metaData[module] ||= {})[imageId] = value;
};
export const __resetMetaData = () => {
  Object.keys(__metaData).forEach(k => delete __metaData[k]);
};
export const metaData = {
  get: jest.fn((module: string, imageId: string) => __metaData[module]?.[imageId]),
  addProvider: jest.fn(),
};
export const utilities = {
  imageIdToURI: jest.fn((id: string) => id),
  // Identity by default: tests that care seed their own conversion.
  worldToImageCoords: jest.fn((_imageId: string, world: number[]) => [world[0], world[1]]),
};
export class VolumeViewport {}
export const Types = {};
