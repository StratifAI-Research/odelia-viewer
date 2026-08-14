export const Enums = {
  ViewportType: { ORTHOGRAPHIC: 'ORTHOGRAPHIC', STACK: 'STACK' },
  OrientationAxis: { AXIAL: 'AXIAL' },
  Events: { STACK_NEW_IMAGE: 'STACK_NEW_IMAGE', VOLUME_NEW_IMAGE: 'VOLUME_NEW_IMAGE' },
};
// Minimal EventTarget stand-in. `useViewerSlice` subscribes to slice-change
// events, so tests need a real add/remove pair plus a way to fire them.
export const eventTarget = {
  listeners: {} as Record<string, Array<() => void>>,
  addEventListener(type: string, cb: () => void) {
    (this.listeners[type] ||= []).push(cb);
  },
  removeEventListener(type: string, cb: () => void) {
    this.listeners[type] = (this.listeners[type] || []).filter(l => l !== cb);
  },
  dispatch(type: string) {
    (this.listeners[type] || []).forEach(cb => cb());
  },
  reset() {
    this.listeners = {};
  },
};
export const getRenderingEngine = jest.fn(() => undefined);
export const metaData = { get: jest.fn(() => undefined), addProvider: jest.fn() };
export const utilities = { imageIdToURI: jest.fn((id: string) => id) };
export class VolumeViewport {}
export const Types = {};
