import React from 'react';
import { installConsoleErrorFilter } from '../../test-utils/harness';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { StudyBrowserNested } from './StudyBrowserNested';

// Drives the confirmation dialog: captures the options passed to
// uiDialogService.show and renders its content with a `hide` that routes to the
// service-provided onClose (matching how the real ManagedDialog wires `hide`).
function makeDialogService() {
  const state: { options: any; contentRender: any } = { options: null, contentRender: null };
  const hide = jest.fn();
  const show = jest.fn((options: any) => {
    state.options = options;
    // Mirror ManagedDialog: the content's `hide` routes to the service-provided
    // onClose (the option's onClose, which overrides the provider default).
    const contentHide = () => options.onClose?.(options.id);
    state.contentRender = render(
      <div data-testid="dialog-root">{options.content({ hide: contentHide })}</div>
    );
  });
  return { service: { show, hide }, state };
}

// The UID→Orthanc-id lookup is owned by orthanc-ai-routing's OrthancAIService:
// it resolves to the id, to null when Orthanc has no such resource, and rejects
// on a transport / non-Orthanc failure.
const makeOrthancAIService = (lookup: any = jest.fn(async () => 'orthanc-1')) => ({
  lookupResourceId: lookup,
});

const makeServices = (over: any = {}) => ({
  services: {
    displaySetService: { getDisplaySetByUID: jest.fn(), deleteDisplaySet: jest.fn() },
    uiDialogService: { show: jest.fn() },
    uiNotificationService: { show: jest.fn() },
    aiResultsService: { removeDisplaySetsFromCache: jest.fn() },
    orthancAIService: makeOrthancAIService(),
    ...over,
  },
});

const study = (over: any = {}) => ({
  studyInstanceUid: 'study-1',
  date: '2024-03-15',
  description: 'Breast MRI',
  numInstances: 3,
  originals: [{ displaySetInstanceUID: 'orig-1' }, { displaySetInstanceUID: 'orig-2' }],
  aiGroups: [
    {
      key: 'grp-1',
      label: 'BreastNet result',
      displaySets: [{ displaySetInstanceUID: 'ai-1' }],
    },
  ],
  ...over,
});

const baseProps = (over: any = {}) => ({
  tabs: [{ name: 'all', label: 'All', studies: [study()] }],
  activeTabName: 'all',
  expandedStudyInstanceUIDs: [],
  onClickTab: jest.fn(),
  onClickStudy: jest.fn(),
  onClickThumbnail: jest.fn(),
  onDoubleClickThumbnail: jest.fn(),
  activeDisplaySetInstanceUIDs: [],
  servicesManager: makeServices(),
  commandsManager: { runCommand: jest.fn() },
  ...over,
});

// Swallow only the testing-library/React ReactDOMTestUtils.act deprecation
// (environmental, fires on effect-driven first renders), re-emit anything else.
installConsoleErrorFilter();

describe('StudyBrowserNested', () => {
  it('renders the settings row when showSettings is true (default)', () => {
    render(<StudyBrowserNested {...baseProps()} />);
    expect(screen.getByTestId('study-browser-view-options')).toBeTruthy();
    expect(screen.getByTestId('study-browser-sort')).toBeTruthy();
  });

  it('omits the settings row when showSettings is false', () => {
    render(<StudyBrowserNested {...baseProps({ showSettings: false })} />);
    expect(screen.queryByTestId('study-browser-view-options')).toBeNull();
  });

  it('renders the study header for the active tab', () => {
    render(<StudyBrowserNested {...baseProps()} />);
    expect(screen.getByText('2024-03-15')).toBeTruthy();
    expect(screen.getByText('Breast MRI')).toBeTruthy();
    expect(screen.getByText('3')).toBeTruthy();
  });

  it('renders no studies when the active tab does not match any tab', () => {
    render(<StudyBrowserNested {...baseProps({ activeTabName: 'missing' })} />);
    expect(screen.queryByText('Breast MRI')).toBeNull();
  });

  it('keeps expanded content collapsed when the study is not expanded', () => {
    render(<StudyBrowserNested {...baseProps()} />);
    expect(screen.queryByTestId('thumbnail-list')).toBeNull();
  });

  it('shows thumbnail lists and the AI group when the study is expanded', () => {
    render(<StudyBrowserNested {...baseProps({ expandedStudyInstanceUIDs: ['study-1'] })} />);
    const lists = screen.getAllByTestId('thumbnail-list');
    // one for originals, one per AI group
    expect(lists).toHaveLength(2);
    expect(lists[0].getAttribute('data-count')).toBe('2');
    expect(lists[1].getAttribute('data-count')).toBe('1');
    expect(screen.getByText('BreastNet result')).toBeTruthy();
  });

  it('fires onClickStudy when the study header is clicked', () => {
    const onClickStudy = jest.fn();
    render(<StudyBrowserNested {...baseProps({ onClickStudy })} />);
    fireEvent.click(screen.getByText('Breast MRI'));
    expect(onClickStudy).toHaveBeenCalledWith('study-1');
  });

  it('shows a delete-confirmation dialog when the AI group delete button is clicked', () => {
    const services = makeServices();
    render(
      <StudyBrowserNested
        {...baseProps({ expandedStudyInstanceUIDs: ['study-1'], servicesManager: services })}
      />
    );
    const deleteBtn = screen.getByTitle('Delete AI Result');
    fireEvent.click(deleteBtn);
    expect(services.services.uiDialogService.show).toHaveBeenCalledTimes(1);
    const arg = services.services.uiDialogService.show.mock.calls[0][0];
    expect(arg.id).toBe('delete-ai-result-confirmation');
  });

  // --- deletion must not desync the viewer from storage, and the confirmation
  // dialog must resolve on every close path ---

  it('keeps the display set in the viewer when the Orthanc DELETE fails', async () => {
    const dialog = makeDialogService();
    const displaySetService = {
      getDisplaySetByUID: jest.fn(() => ({ SeriesInstanceUID: 'series-x' })),
      deleteDisplaySet: jest.fn(),
    };
    const uiNotificationService = { show: jest.fn() };
    const aiResultsService = { removeDisplaySetsFromCache: jest.fn() };
    const svc = makeServices({
      displaySetService,
      uiDialogService: dialog.service,
      uiNotificationService,
      aiResultsService,
    });
    (global as any).fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 500, statusText: 'error' }); // DELETE fails

    render(
      <StudyBrowserNested
        {...baseProps({ expandedStudyInstanceUIDs: ['study-1'], servicesManager: svc })}
      />
    );
    fireEvent.click(screen.getByTitle('Delete AI Result'));
    await act(async () => {
      fireEvent.click(dialog.state.contentRender.getByText('Delete'));
    });
    await waitFor(() => expect(uiNotificationService.show).toHaveBeenCalled());

    // Storage delete failed → the display set must stay in the viewer and cache,
    // so the UI keeps matching PACS instead of hiding a series still on the server.
    expect(displaySetService.deleteDisplaySet).not.toHaveBeenCalled();
    expect(aiResultsService.removeDisplaySetsFromCache).not.toHaveBeenCalled();
    const notif = uiNotificationService.show.mock.calls[0][0];
    expect(notif.title).toBe('Deletion Incomplete');
    expect(notif.type).toBe('warning');
  });

  it('removes the display set only after a successful storage DELETE', async () => {
    const dialog = makeDialogService();
    const displaySetService = {
      getDisplaySetByUID: jest.fn(() => ({ SeriesInstanceUID: 'series-x' })),
      deleteDisplaySet: jest.fn(),
    };
    const uiNotificationService = { show: jest.fn() };
    const aiResultsService = { removeDisplaySetsFromCache: jest.fn() };
    const svc = makeServices({
      displaySetService,
      uiDialogService: dialog.service,
      uiNotificationService,
      aiResultsService,
    });
    (global as any).fetch = jest.fn().mockResolvedValueOnce({ ok: true, status: 200 }); // DELETE succeeds

    render(
      <StudyBrowserNested
        {...baseProps({ expandedStudyInstanceUIDs: ['study-1'], servicesManager: svc })}
      />
    );
    fireEvent.click(screen.getByTitle('Delete AI Result'));
    await act(async () => {
      fireEvent.click(dialog.state.contentRender.getByText('Delete'));
    });
    await waitFor(() => expect(uiNotificationService.show).toHaveBeenCalled());

    expect(displaySetService.deleteDisplaySet).toHaveBeenCalledWith('ai-1');
    expect(aiResultsService.removeDisplaySetsFromCache).toHaveBeenCalledWith('study-1', ['ai-1']);
    expect(uiNotificationService.show.mock.calls[0][0].type).toBe('success');
  });

  it('removes the display set when Orthanc reports no such series (already gone)', async () => {
    const dialog = makeDialogService();
    const displaySetService = {
      getDisplaySetByUID: jest.fn(() => ({ SeriesInstanceUID: 'series-x' })),
      deleteDisplaySet: jest.fn(),
    };
    const uiNotificationService = { show: jest.fn() };
    const aiResultsService = { removeDisplaySetsFromCache: jest.fn() };
    const svc = makeServices({
      displaySetService,
      uiDialogService: dialog.service,
      uiNotificationService,
      aiResultsService,
      // Lookup succeeds but Orthanc holds no such Series → already absent.
      orthancAIService: makeOrthancAIService(jest.fn(async () => null)),
    });
    (global as any).fetch = jest.fn();

    render(
      <StudyBrowserNested
        {...baseProps({ expandedStudyInstanceUIDs: ['study-1'], servicesManager: svc })}
      />
    );
    fireEvent.click(screen.getByTitle('Delete AI Result'));
    await act(async () => {
      fireEvent.click(dialog.state.contentRender.getByText('Delete'));
    });
    await waitFor(() => expect(uiNotificationService.show).toHaveBeenCalled());

    // Confirmed-absent series is dropped from the viewer (kept in sync), with no
    // DELETE call attempted.
    expect(displaySetService.deleteDisplaySet).toHaveBeenCalledWith('ai-1');
    expect((global as any).fetch).not.toHaveBeenCalled(); // no DELETE
    expect(uiNotificationService.show.mock.calls[0][0].type).toBe('success');
  });

  it('keeps the display set in the viewer when the Orthanc lookup fails', async () => {
    const dialog = makeDialogService();
    const displaySetService = {
      getDisplaySetByUID: jest.fn(() => ({ SeriesInstanceUID: 'series-x' })),
      deleteDisplaySet: jest.fn(),
    };
    const uiNotificationService = { show: jest.fn() };
    const aiResultsService = { removeDisplaySetsFromCache: jest.fn() };
    const svc = makeServices({
      displaySetService,
      uiDialogService: dialog.service,
      uiNotificationService,
      aiResultsService,
      // A transport / non-Orthanc failure rejects rather than resolving to null,
      // so it must NOT be mistaken for "already deleted".
      orthancAIService: makeOrthancAIService(
        jest.fn(async () => {
          throw new Error('Cannot reach the Orthanc server at http://x.');
        })
      ),
    });
    (global as any).fetch = jest.fn();

    render(
      <StudyBrowserNested
        {...baseProps({ expandedStudyInstanceUIDs: ['study-1'], servicesManager: svc })}
      />
    );
    fireEvent.click(screen.getByTitle('Delete AI Result'));
    await act(async () => {
      fireEvent.click(dialog.state.contentRender.getByText('Delete'));
    });
    await waitFor(() => expect(uiNotificationService.show).toHaveBeenCalled());

    expect((global as any).fetch).not.toHaveBeenCalled(); // never reached the DELETE
    expect(displaySetService.deleteDisplaySet).not.toHaveBeenCalled();
    expect(aiResultsService.removeDisplaySetsFromCache).not.toHaveBeenCalled();
    expect(uiNotificationService.show.mock.calls[0][0].title).toBe('Deletion Incomplete');
  });

  it('does not remove anything when orthancAIService is not registered', async () => {
    const dialog = makeDialogService();
    const displaySetService = {
      getDisplaySetByUID: jest.fn(() => ({ SeriesInstanceUID: 'series-x' })),
      deleteDisplaySet: jest.fn(),
    };
    const uiNotificationService = { show: jest.fn() };
    const svc = makeServices({
      displaySetService,
      uiDialogService: dialog.service,
      uiNotificationService,
      orthancAIService: undefined,
    });
    (global as any).fetch = jest.fn();

    render(
      <StudyBrowserNested
        {...baseProps({ expandedStudyInstanceUIDs: ['study-1'], servicesManager: svc })}
      />
    );
    fireEvent.click(screen.getByTitle('Delete AI Result'));
    await act(async () => {
      fireEvent.click(dialog.state.contentRender.getByText('Delete'));
    });
    await waitFor(() => expect(uiNotificationService.show).toHaveBeenCalled());

    // Without the service the storage copy cannot be deleted, so the viewer must
    // keep the series rather than hiding one that is still on the server.
    expect((global as any).fetch).not.toHaveBeenCalled();
    expect(displaySetService.deleteDisplaySet).not.toHaveBeenCalled();
    expect(uiNotificationService.show.mock.calls[0][0].title).toBe('Deletion Incomplete');
  });

  it('skips a stale group entry that no longer resolves to a display set', async () => {
    const dialog = makeDialogService();
    // getDisplaySetByUID returns undefined → stale entry. Must NOT call
    // deleteDisplaySet (which would splice at index -1 and drop the last set).
    const displaySetService = {
      getDisplaySetByUID: jest.fn(() => undefined),
      deleteDisplaySet: jest.fn(),
    };
    const uiNotificationService = { show: jest.fn() };
    const aiResultsService = { removeDisplaySetsFromCache: jest.fn() };
    const svc = makeServices({
      displaySetService,
      uiDialogService: dialog.service,
      uiNotificationService,
      aiResultsService,
    });
    (global as any).fetch = jest.fn();

    render(
      <StudyBrowserNested
        {...baseProps({ expandedStudyInstanceUIDs: ['study-1'], servicesManager: svc })}
      />
    );
    fireEvent.click(screen.getByTitle('Delete AI Result'));
    await act(async () => {
      fireEvent.click(dialog.state.contentRender.getByText('Delete'));
    });
    await waitFor(() => expect(uiNotificationService.show).toHaveBeenCalled());

    expect(displaySetService.deleteDisplaySet).not.toHaveBeenCalled();
    expect((global as any).fetch).not.toHaveBeenCalled();
  });

  it('dismissing the dialog via Esc/overlay resolves without deleting', async () => {
    const dialog = makeDialogService();
    const displaySetService = { getDisplaySetByUID: jest.fn(), deleteDisplaySet: jest.fn() };
    const uiNotificationService = { show: jest.fn() };
    const svc = makeServices({
      displaySetService,
      uiDialogService: dialog.service,
      uiNotificationService,
    });
    (global as any).fetch = jest.fn();

    render(
      <StudyBrowserNested
        {...baseProps({ expandedStudyInstanceUIDs: ['study-1'], servicesManager: svc })}
      />
    );
    fireEvent.click(screen.getByTitle('Delete AI Result'));
    // Esc / overlay click: onClose fires with no button pressed, which must still
    // settle the awaited Promise.
    await act(async () => {
      dialog.state.options.onClose(dialog.state.options.id);
    });

    expect((global as any).fetch).not.toHaveBeenCalled();
    expect(displaySetService.deleteDisplaySet).not.toHaveBeenCalled();
    expect(uiNotificationService.show).not.toHaveBeenCalled();
    // The custom onClose must still dismiss the modal (the provider's spread
    // overrides its own hide, so we dismiss explicitly via the service).
    expect(dialog.service.hide).toHaveBeenCalledWith('delete-ai-result-confirmation');
  });

  it('falls back to "No Study Date" when the study has no date', () => {
    const props = baseProps();
    props.tabs[0].studies = [study({ date: '' })];
    render(<StudyBrowserNested {...props} />);
    expect(screen.getByText('No Study Date')).toBeTruthy();
  });

  // ODV-80: a study that arrives without a UID (as produced by the
  // nested-tab grouping path the panels feed in) must not trigger React's
  // "each child needs a unique key" warning — the render now supplies an index
  // fallback key.
  it('renders studies without a missing-key warning when a study has no UID', () => {
    // Save/restore console.error by reference (not jest.spyOn().mockRestore(),
    // which would pop the suite-level console filter installed by the harness).
    const errors: unknown[] = [];
    const original = console.error;
    console.error = ((...args: unknown[]) => {
      errors.push(args[0]);
    }) as typeof console.error;

    try {
      const props = baseProps();
      props.tabs[0].studies = [study({ studyInstanceUid: undefined })];
      render(<StudyBrowserNested {...props} />);
    } finally {
      console.error = original;
    }

    const keyWarning = errors.some(e => typeof e === 'string' && e.includes('unique "key"'));
    expect(keyWarning).toBe(false);
  });
});
