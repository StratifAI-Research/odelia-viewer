export const SynchronizerManager = {
  createSynchronizer: jest.fn(() => ({ add: jest.fn(), destroy: jest.fn() })),
  getSynchronizer: jest.fn(),
};
export class Synchronizer {}
