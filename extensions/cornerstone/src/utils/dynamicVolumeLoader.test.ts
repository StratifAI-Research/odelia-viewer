import type { StreamingDynamicImageVolume } from '@cornerstonejs/core';
import { RequestType } from '@cornerstonejs/core/enums';
import { cornerstoneStreamingDynamicImageVolumeLoader } from '@cornerstonejs/core/loaders';
import dynamicVolumeLoader from './dynamicVolumeLoader';
import { cache } from '@cornerstonejs/core';

// Exercise the real OHIF strategies alongside the installed Cornerstone classes.
const nthLoader = jest.requireActual('./nthLoader').default;
const interleaveCenterLoader = jest.requireActual('./interleaveCenterLoader').default;
const interleaveTopToBottom = jest.requireActual('./interleaveTopToBottom').default;

// Jest resolves these implementation paths without importing the renderer-heavy
// public barrel. Use public types so TypeScript still checks the installed API.
const DynamicVolume = jest.requireActual(
  '@cornerstonejs/core/cache/classes/StreamingDynamicImageVolume'
).default as typeof import('@cornerstonejs/core').StreamingDynamicImageVolume;
const StaticVolume = jest.requireActual('@cornerstonejs/core/cache/classes/StreamingImageVolume')
  .default as typeof import('@cornerstonejs/core').StreamingImageVolume;
const imageLoadPoolManager = jest.requireActual(
  '@cornerstonejs/core/requestPool/imageLoadPoolManager'
).default as typeof import('@cornerstonejs/core').imageLoadPoolManager;

// Keep the installed dynamic/static classes, base request generation, loadImages,
// and request pool real. Only isolate metadata/GPU allocation and image decoding.
jest.mock('@cornerstonejs/core/cache/classes/ImageVolume', () => ({
  __esModule: true,
  default: class {
    imageIds: string[];
    numDimensionGroups: number;
    constructor(props) {
      const { splittingTag, ...volumeProps } = props;
      Object.assign(this, volumeProps);
    }
    getImageIdIndex(imageId) {
      return this.imageIds.indexOf(imageId);
    }
    isDynamicVolume() {
      return this.numDimensionGroups !== undefined;
    }
  },
}));
jest.mock('@cornerstonejs/core/utilities', () => ({ triggerEvent: jest.fn() }));
jest.mock('@cornerstonejs/core/utilities/autoLoad', () => jest.fn());
jest.mock('@cornerstonejs/core/init', () => ({ canRenderFloatTextures: () => true }));
jest.mock('@cornerstonejs/core/loaders/imageLoader', () => ({ loadAndCacheImage: jest.fn() }));
jest.mock('@cornerstonejs/core/loaders/ProgressiveRetrieveImages', () => ({
  __esModule: true,
  default: {},
}));
jest.mock('@cornerstonejs/core/loaders', () => ({
  cornerstoneStreamingDynamicImageVolumeLoader: jest.fn(),
}));
jest.mock('@cornerstonejs/core', () => ({
  cache: { getVolume: jest.fn() },
  imageLoadPoolManager: jest.requireActual('@cornerstonejs/core/requestPool/imageLoadPoolManager')
    .default,
  Enums: jest.requireActual('@cornerstonejs/core/enums'),
}));

const upstreamLoader = jest.mocked(cornerstoneStreamingDynamicImageVolumeLoader);
const groups = [
  ['p1-s1', 'p1-s2', 'p1-s3'],
  ['p2-s1', 'p2-s2', 'p2-s3'],
  ['p3-s1', 'p3-s2', 'p3-s3'],
];

function createVolume(imageIdGroups = groups, dynamic = true) {
  const Volume = dynamic ? DynamicVolume : StaticVolume;
  const volume = new Volume(
    {
      volumeId: 'test-volume',
      metadata: { SeriesInstanceUID: 'test-series' },
      imageIds: imageIdGroups.flat(),
      imageIdGroups,
      splittingTag: 'TemporalPositionIdentifier',
      dimensions: [1, 1, imageIdGroups[0].length],
      voxelManager: { setDimensionGroupNumber: jest.fn() },
    } as any,
    { loadStatus: { loaded: false, loading: false, cancelled: false, callbacks: [] } } as any
  );
  jest.spyOn(volume, 'getLoaderImageOptions').mockReturnValue({} as any);
  // Invalidation is protected in the public types and would touch GPU state.
  jest.spyOn(volume as any, 'invalidateVolume').mockImplementation(() => {});
  jest.spyOn(volume, 'callLoadImage').mockImplementation(() => Promise.resolve());
  return volume;
}

function queuedImageIds(volume, priority = 5) {
  const requests = imageLoadPoolManager.getRequestPool()[RequestType.Prefetch][priority] || [];
  for (const request of requests) {
    expect(request.additionalDetails.volumeId).toBe(volume.volumeId);
    request.requestFn();
  }
  return volume.callLoadImage.mock.calls.map(([imageId, index]) => {
    expect(index).toBe(volume.imageIds.indexOf(imageId));
    return imageId;
  });
}

beforeEach(() => {
  upstreamLoader.mockReset();
  jest.mocked(cache.getVolume).mockReset();
  imageLoadPoolManager.clearRequestStack(RequestType.Prefetch);
  imageLoadPoolManager.setMaxSimultaneousRequests(RequestType.Prefetch, 0);
});

afterEach(() => {
  imageLoadPoolManager.clearRequestStack(RequestType.Prefetch);
  imageLoadPoolManager.setMaxSimultaneousRequests(RequestType.Prefetch, 1000);
  imageLoadPoolManager.destroy();
});

test('reproduces the upstream reversed dynamic queue without the adapter', async () => {
  const volume = createVolume();
  await volume.loadImages();
  expect(queuedImageIds(volume)).toEqual(groups.flat().reverse());
});

test.each([
  [1, [0, 1, 2]],
  [2, [1, 0, 2]],
  [3, [2, 1, 0]],
])('queues active group %i first through the installed base loader', async (active, order) => {
  const volume = createVolume() as StreamingDynamicImageVolume;
  upstreamLoader.mockReturnValue({
    promise: Promise.resolve(volume),
    cancel: jest.fn(),
    decache: jest.fn(),
  });
  const adapted = await dynamicVolumeLoader('test-volume', { imageIds: groups.flat() }).promise;
  // Read the active phase at request time, even if it changed after creation.
  adapted.dimensionGroupNumber = active as number;
  await adapted.loadImages();
  expect(queuedImageIds(adapted)).toEqual((order as number[]).flatMap(index => groups[index]));
  expect(adapted.imageIds).toEqual(groups.flat());
});

test('uses actual group membership for uneven groups', async () => {
  const uneven = [['a'], ['b', 'c', 'd'], ['e', 'f']];
  const volume = createVolume(uneven) as StreamingDynamicImageVolume;
  upstreamLoader.mockReturnValue({
    promise: Promise.resolve(volume),
    cancel: jest.fn(),
    decache: jest.fn(),
  });
  const adapted = await dynamicVolumeLoader('test-volume', { imageIds: uneven.flat() }).promise;
  adapted.dimensionGroupNumber = 2;
  await adapted.loadImages();
  expect(queuedImageIds(adapted)).toEqual(['b', 'c', 'd', 'a', 'e', 'f']);
});

test('leaves static volume queue ordering unchanged', async () => {
  const volume = createVolume([groups[0]], false);
  await volume.loadImages();
  expect(queuedImageIds(volume)).toEqual([...groups[0]].reverse());
});

test('preserves loader arguments, cancellation and disposal', async () => {
  const volume = createVolume() as StreamingDynamicImageVolume;
  const original = { promise: Promise.resolve(volume), cancel: jest.fn(), decache: jest.fn() };
  upstreamLoader.mockReturnValue(original);
  const options = { imageIds: groups.flat() };
  const adapted = dynamicVolumeLoader('test-volume', options);
  expect(upstreamLoader).toHaveBeenCalledWith('test-volume', options);
  expect(adapted.cancel).toBe(original.cancel);
  expect(adapted.decache).toBe(original.decache);
  await expect(adapted.promise).resolves.toBe(volume);
});

test('propagates volume creation failures', async () => {
  const error = new Error('bad metadata');
  upstreamLoader.mockReturnValue({
    promise: Promise.reject(error),
    cancel: jest.fn(),
    decache: jest.fn(),
  });
  await expect(dynamicVolumeLoader('test-volume', { imageIds: [] }).promise).rejects.toBe(error);
});

async function adaptVolume(volume) {
  upstreamLoader.mockReturnValue({
    promise: Promise.resolve(volume),
    cancel: jest.fn(),
    decache: jest.fn(),
  });
  return dynamicVolumeLoader(volume.volumeId, { imageIds: volume.imageIds }).promise;
}

test('preserves direct request ordering before and immediately after loading', async () => {
  const volume = createVolume() as StreamingDynamicImageVolume;
  const originalRequests = volume.getImageLoadRequests;
  const adapted = await adaptVolume(volume);

  for (const active of [1, 2, 3]) {
    adapted.dimensionGroupNumber = active;
    const expected = originalRequests.call(volume, 7);
    expect(adapted.getImageLoadRequests).toBe(originalRequests);
    expect(adapted.getImageLoadRequests(7).map(request => request.imageId)).toEqual(
      expected.map(request => request.imageId)
    );
    expect(adapted.getImageLoadRequests(7).every(request => request.priority === 7)).toBe(true);

    const loading = adapted.loadImages();
    // Restore synchronously: custom strategies must not see the reversal even
    // while the returned promise is pending.
    expect(adapted.getImageLoadRequests).toBe(originalRequests);
    await loading;
  }
});

describe.each([
  ['nth', nthLoader],
  ['interleaveCenter', interleaveCenterLoader],
  ['interleaveTopToBottom', interleaveTopToBottom],
] as const)('%s strategy', (name, strategy) => {
  test.each([1, 2, 3])('preserves the full queue for active phase %i', async active => {
    const imageIdGroups = Array.from({ length: 3 }, (_, phase) =>
      Array.from({ length: 86 }, (_, slice) => `p${phase + 1}-s${slice + 1}`)
    );
    const baseline = createVolume(imageIdGroups) as StreamingDynamicImageVolume;
    const adapted = await adaptVolume(createVolume(imageIdGroups));
    baseline.dimensionGroupNumber = active;
    adapted.dimensionGroupNumber = active;

    function runStrategy(volume) {
      imageLoadPoolManager.clearRequestStack(RequestType.Prefetch);
      volume.callLoadImage.mockClear();
      jest.mocked(cache.getVolume).mockReturnValue(volume);
      strategy({
        data: { viewportId: 'test-viewport', volumeInputArray: [{ volumeId: volume.volumeId }] },
        displaySetsMatchDetails: new Map(),
        viewportMatchDetails: new Map([
          ['test-viewport', { displaySetsInfo: [{ displaySetInstanceUID: 'test-series' }] }],
        ]),
      });
      return queuedImageIds(volume, 0);
    }

    const expected = runStrategy(baseline);
    expect(expected).toHaveLength(258);
    expect(new Set(expected).size).toBe(258);
    expect(runStrategy(adapted)).toEqual(expected);

    // Calling the default loader must not leave custom strategies altered.
    await adapted.loadImages();
    expect(runStrategy(adapted)).toEqual(expected);

    if (name === 'nth' && active === 1) {
      const activePhasePositions = imageIdGroups[0].map(imageId => expected.indexOf(imageId) + 1);
      expect(Math.max(...activePhasePositions)).toBe(200);
    }
  });
});

test('restores request generation when the installed loader throws', async () => {
  const volume = createVolume() as StreamingDynamicImageVolume;
  const error = new Error('request creation failed');
  const getRequests = jest.spyOn(volume, 'getImageLoadRequests').mockImplementationOnce(() => {
    throw error;
  });
  const adapted = await adaptVolume(volume);
  expect(() => adapted.loadImages()).toThrow(error);
  expect(adapted.getImageLoadRequests).toBe(getRequests);
  expect(adapted.getImageLoadRequests(5).map(request => request.imageId)).toEqual(groups.flat());
});

test('preserves the load promise and restores requests before it rejects', async () => {
  const volume = createVolume() as StreamingDynamicImageVolume;
  const originalRequests = volume.getImageLoadRequests;
  const error = new Error('loading failed');
  const loading = Promise.reject(error);
  const rejection = expect(loading).rejects.toBe(error);
  const loadImages = jest.spyOn(volume, 'loadImages').mockReturnValue(loading);
  const adapted = await adaptVolume(volume);

  const result = adapted.loadImages();
  expect(result).toBe(loading);
  expect(loadImages.mock.contexts).toEqual([volume]);
  expect(adapted.getImageLoadRequests).toBe(originalRequests);
  await rejection;
});
