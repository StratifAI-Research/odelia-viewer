// `@ohif/mode-basic` is not resolvable from this package, so mock it virtually.
jest.mock('@ohif/mode-basic', () => ({ registerModeToolbar: jest.fn() }), { virtual: true });

import mode from './index';

/**
 * OHIF's ModeRoute runs `defaultRouteInit` right after this mode's `route.init`
 * (platform/app/src/routes/Mode/Mode.tsx) and throws away whatever `init`
 * returns. So `init` must do this mode's own setup ONLY: anything it duplicates
 * from defaultRouteInit costs a second round of metadata requests and a second
 * hanging-protocol run, and any subscription it opens can never be closed.
 */
describe('labeling-mode route init', () => {
  const getRoute = () => mode.modeFactory().routes[0];

  const makeArgs = (studyInstanceUIDs = ['study-1']) => {
    const initLabels = jest.fn();
    const measurementService = {};
    const displaySetService = {
      makeDisplaySets: jest.fn(),
      getActiveDisplaySets: jest.fn(() => []),
    };
    const hangingProtocolService = { run: jest.fn() };
    const dataSource = { retrieve: { series: { metadata: jest.fn() } } };

    return {
      initLabels,
      displaySetService,
      hangingProtocolService,
      dataSource,
      args: {
        servicesManager: {
          services: { measurementService, displaySetService, hangingProtocolService },
        },
        extensionManager: {
          getModuleEntry: jest.fn(() => ({ exports: initLabels })),
        },
        studyInstanceUIDs,
        dataSource,
        filters: {},
      },
      measurementService,
    };
  };

  it('initializes labels for the first study', async () => {
    const { args, initLabels, measurementService } = makeArgs(['study-1']);

    await getRoute().init(args);

    expect(args.extensionManager.getModuleEntry).toHaveBeenCalledWith(
      'labeling.utilityModule.initLabels'
    );
    expect(initLabels).toHaveBeenCalledWith({
      extensionManager: args.extensionManager,
      measurementService,
      StudyInstanceUID: 'study-1',
    });
  });

  it('warns that only the first study is labelled when opened with several', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { args, initLabels } = makeArgs(['study-1', 'study-2']);

    let warnings: unknown[];
    try {
      await getRoute().init(args);
    } finally {
      // Snapshot the calls before restoring: mockRestore() also resets them.
      warnings = warn.mock.calls.flat();
      warn.mockRestore();
    }

    expect(warnings).toContainEqual(expect.stringContaining('opened with 2 studies'));
    expect(initLabels).toHaveBeenCalledWith(
      expect.objectContaining({ StudyInstanceUID: 'study-1' })
    );
  });

  it('leaves metadata retrieval and the hanging protocol to defaultRouteInit', async () => {
    const { args, dataSource, displaySetService, hangingProtocolService } = makeArgs();

    await getRoute().init(args);

    expect(dataSource.retrieve.series.metadata).not.toHaveBeenCalled();
    expect(displaySetService.makeDisplaySets).not.toHaveBeenCalled();
    expect(hangingProtocolService.run).not.toHaveBeenCalled();
  });

  it('registers no subscription, because ModeRoute discards init’s return value', async () => {
    const { args } = makeArgs();

    const returned = await getRoute().init(args);

    expect(returned).toBeUndefined();
  });
});
