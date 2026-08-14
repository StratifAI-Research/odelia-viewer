export const Enums = {
  ViewportType: { ORTHOGRAPHIC: 'ORTHOGRAPHIC', STACK: 'STACK' },
  OrientationAxis: { AXIAL: 'AXIAL' },
  Events: { STACK_NEW_IMAGE: 'STACK_NEW_IMAGE', VOLUME_NEW_IMAGE: 'VOLUME_NEW_IMAGE' },
};
// Minimal EventTarget stand-in. `useViewerSlice` subscribes to slice-change
// events, so tests need a real add/remove pair plus a way to fire them.
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
