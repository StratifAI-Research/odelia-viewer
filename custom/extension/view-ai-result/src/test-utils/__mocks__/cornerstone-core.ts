export const Enums = {
  ViewportType: { ORTHOGRAPHIC: 'ORTHOGRAPHIC', STACK: 'STACK' },
  OrientationAxis: { AXIAL: 'AXIAL' },
  Events: { STACK_NEW_IMAGE: 'STACK_NEW_IMAGE', VOLUME_NEW_IMAGE: 'VOLUME_NEW_IMAGE' },
};
export const getRenderingEngine = jest.fn(() => undefined);
export const metaData = { get: jest.fn(() => undefined), addProvider: jest.fn() };
export const utilities = { imageIdToURI: jest.fn((id: string) => id) };
export class VolumeViewport {}
export const Types = {};
