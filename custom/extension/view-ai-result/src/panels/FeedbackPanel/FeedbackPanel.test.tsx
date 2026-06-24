import React from 'react';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';
import { makeServicesManager, withSystem } from '../../test-utils/harness';

// Mutable hook returns so each test drives identity / viewport branches.
let mockImageViewerReturn: any = { StudyInstanceUIDs: ['study-1'] };
let mockAuthReturn: any = [{ user: null }];
let mockViewportGridReturn: any = [
  { activeViewportId: null, viewports: new Map() },
  { setActiveViewportId: jest.fn() },
];

jest.mock('@ohif/ui', () => {
  const actual = jest.requireActual('@ohif/ui');
  return {
    ...actual,
    useImageViewer: () => mockImageViewerReturn,
    useUserAuthentication: () => mockAuthReturn,
  };
});

jest.mock('@ohif/ui-next', () => {
  const actual = jest.requireActual('@ohif/ui-next');
  return { ...actual, useViewportGrid: () => mockViewportGridReturn };
});

import FeedbackPanel from './FeedbackPanel';

// AI result metadata + current result fixtures.
const META = [
  { displaySetInstanceUID: 'sr-1', modelName: 'BreastNet', isSelected: true },
  { displaySetInstanceUID: 'sr-2', modelName: 'BreastNet v2', isSelected: false },
];
const CURRENT = {
  modelInfo: { name: 'BreastNet', algorithmVersion: '1.2.0' },
  resultTs: '2024-03-15T10:00:00Z',
  classifications: [
    { side: 'Left', result: 'Benign', confidence: 88.5 },
    { side: 'Right', result: 'Malignant', confidence: 91.2 },
  ],
};

function makeAiResultsService(over: any = {}) {
  return {
    EVENTS: { AI_RESULT_SELECTED: 'sel' },
    subscribe: jest.fn(() => ({ unsubscribe: jest.fn() })),
    getAIResultMetadata: jest.fn(() => META),
    getSelectedAIResult: jest.fn(() => CURRENT),
    setSelectedAIResult: jest.fn(),
    getAIResultByDisplaySet: jest.fn(() => CURRENT),
    ...over,
  };
}

function services(over: any = {}) {
  return makeServicesManager({
    services: {
      aiResultsService: makeAiResultsService(over.aiResultsService),
      userAuthenticationService: { getUser: jest.fn(() => null), setUser: jest.fn(), ...over.userAuthenticationService },
      uiNotificationService: { show: jest.fn() },
      uiModalService: { show: jest.fn() },
      displaySetService: { getDisplaySetByUID: jest.fn(() => null) },
      ...over.services,
    },
  });
}

const realError = console.error;
beforeAll(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation((...args: any[]) => {
    if (typeof args[0] === 'string' && args[0].includes('ReactDOMTestUtils.act')) {
      return;
    }
    realError(...args);
  });
});
afterAll(() => {
  (console.log as jest.Mock).mockRestore();
  (console.error as jest.Mock).mockRestore();
});

beforeEach(() => {
  jest.clearAllMocks();
  window.localStorage.clear();
  mockImageViewerReturn = { StudyInstanceUIDs: ['study-1'] };
  mockAuthReturn = [{ user: null }];
  mockViewportGridReturn = [{ activeViewportId: null, viewports: new Map() }, { setActiveViewportId: jest.fn() }];
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ users: [] }), text: async () => '' });
});

async function renderPanel(svc = services()) {
  withSystem(svc);
  let utils: any;
  await act(async () => {
    utils = render(<FeedbackPanel />);
  });
  // Flush the async per-result feedback-marker effect (Promise.all of fetches)
  // so its trailing setState lands inside act and the tree is settled.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return { ...utils, svc };
}

describe('FeedbackPanel', () => {
  it('shows the name prompt when no user identity is resolvable', async () => {
    await renderPanel();
    expect(screen.getByText('Please enter your name to provide feedback.')).toBeTruthy();
    const save = screen.getByText('Save') as HTMLButtonElement;
    expect(save.disabled).toBe(true);
  });

  it('enables Save once a name is typed, persists it, and reflects identity into the auth service', async () => {
    const svc = services();
    await renderPanel(svc);
    const input = screen.getByPlaceholderText('Your name');
    fireEvent.change(input, { target: { value: ' Dr Who ' } });
    const save = screen.getByText('Save') as HTMLButtonElement;
    expect(save.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(save);
    });
    expect(window.localStorage.getItem('ohif.aiFeedback.displayName')).toBe('Dr Who');
    expect(svc.services.userAuthenticationService.setUser).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'Dr Who', name: 'Dr Who', source: 'local' })
    );
  });

  it('renders the full form once a user identity exists (from auth profile)', async () => {
    mockAuthReturn = [{ user: { profile: { preferred_username: 'radiologist1' } } }];
    await renderPanel();
    expect(screen.getByText(/Signed in as/)).toBeTruthy();
    expect(screen.getByText('radiologist1')).toBeTruthy();
    // Submit present and disabled until both sides chosen.
    const submit = screen.getByText('Submit Feedback') as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it('shows the AI model info and per-side AI predictions when a result is selected', async () => {
    mockAuthReturn = [{ user: { profile: { sub: 'u1' } } }];
    await renderPanel();
    expect(screen.getByText(/AI Prediction: Benign/)).toBeTruthy();
    expect(screen.getByText(/AI Prediction: Malignant/)).toBeTruthy();
    expect(screen.getByText('Left Breast')).toBeTruthy();
    expect(screen.getByText('Right Breast')).toBeTruthy();
  });

  it('shows "No AI result selected." when the service has no current result', async () => {
    mockAuthReturn = [{ user: { profile: { sub: 'u1' } } }];
    const svc = services();
    svc.services.aiResultsService.getSelectedAIResult = jest.fn(() => null);
    svc.services.aiResultsService.getAIResultMetadata = jest.fn(() => []);
    await renderPanel(svc);
    expect(screen.getByText('No AI result selected.')).toBeTruthy();
  });

  it('keeps submit disabled until both Left and Right verdicts are chosen (validation branch)', async () => {
    mockAuthReturn = [{ user: { profile: { sub: 'u1' } } }];
    await renderPanel();
    const submit = () => screen.getByText('Submit Feedback') as HTMLButtonElement;
    expect(submit().disabled).toBe(true);
    // Choose Left only -> still disabled (Right verdict missing).
    fireEvent.click(screen.getAllByDisplayValue('Agree')[0]);
    expect(submit().disabled).toBe(true);
    // Choosing Right too enables it.
    fireEvent.click(screen.getAllByDisplayValue('Agree')[1]);
    expect(submit().disabled).toBe(false);
  });

  it('submits a valid payload on 201 and shows a success notification', async () => {
    mockAuthReturn = [{ user: { profile: { sub: 'rad-7' } } }];
    const svc = services();
    const fetchMock = jest
      .fn()
      // checkSubmissionStatus + per-result markers polling
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ users: [] }), text: async () => '' });
    (global as any).fetch = fetchMock;
    await renderPanel(svc);

    // Choose a verdict on both sides.
    const lefts = screen.getAllByDisplayValue('Agree');
    fireEvent.click(lefts[0]); // Left Agree
    const disagrees = screen.getAllByDisplayValue('Disagree');
    fireEvent.click(disagrees[1]); // Right Disagree

    // Next submit POST returns 201; the follow-up status refetch reports the
    // user as already submitted so the panel stays locked.
    fetchMock.mockResolvedValueOnce({ status: 201, ok: true, json: async () => ({}), text: async () => '' });
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ users: [{ user_id: 'rad-7', verdict_L: 1, verdict_R: -1 }] }),
      text: async () => '',
    });

    const submit = screen.getByText('Submit Feedback') as HTMLButtonElement;
    expect(submit.disabled).toBe(false);
    await act(async () => {
      fireEvent.click(submit);
    });

    const postCall = fetchMock.mock.calls.find(c => String(c[0]).includes('/feedback/submit'));
    expect(postCall).toBeTruthy();
    const body = JSON.parse(postCall![1].body);
    expect(body).toMatchObject({
      study_uid: 'study-1',
      model_name: 'BreastNet',
      model_version: '1.2.0',
      user_id: 'rad-7',
      verdict_L: 1, // Agree
      verdict_R: -1, // Disagree
    });
    await waitFor(() =>
      expect(svc.services.uiNotificationService.show).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'success' })
      )
    );
    // After a successful submit the panel locks and offers an Edit button.
    expect(screen.getByText('Edit Feedback')).toBeTruthy();
  });

  it('surfaces a 409 conflict as an "Already submitted" message', async () => {
    mockAuthReturn = [{ user: { profile: { sub: 'rad-7' } } }];
    const svc = services();
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ users: [] }), text: async () => '' });
    (global as any).fetch = fetchMock;
    await renderPanel(svc);
    fireEvent.click(screen.getAllByDisplayValue('Agree')[0]);
    fireEvent.click(screen.getAllByDisplayValue('Agree')[1]);
    fetchMock.mockResolvedValueOnce({ status: 409, ok: false, json: async () => ({}), text: async () => '' });
    await act(async () => {
      fireEvent.click(screen.getByText('Submit Feedback'));
    });
    await waitFor(() => expect(screen.getByText('Already submitted for this result.')).toBeTruthy());
  });

  it('shows an error message when the submit POST fails with a server error body', async () => {
    mockAuthReturn = [{ user: { profile: { sub: 'rad-7' } } }];
    const svc = services();
    const fetchMock = jest
      .fn()
      .mockResolvedValue({ ok: true, status: 200, json: async () => ({ users: [] }), text: async () => '' });
    (global as any).fetch = fetchMock;
    await renderPanel(svc);
    fireEvent.click(screen.getAllByDisplayValue('Agree')[0]);
    fireEvent.click(screen.getAllByDisplayValue('Agree')[1]);
    fetchMock.mockResolvedValueOnce({ status: 500, ok: false, json: async () => ({}), text: async () => 'boom' });
    await act(async () => {
      fireEvent.click(screen.getByText('Submit Feedback'));
    });
    await waitFor(() => expect(screen.getByText('boom')).toBeTruthy());
  });

  it('changing the AI result dropdown calls setSelectedAIResult with the new UID', async () => {
    mockAuthReturn = [{ user: { profile: { sub: 'u1' } } }];
    const svc = services();
    await renderPanel(svc);
    const select = screen.getByRole('combobox') as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(select, { target: { value: 'sr-2' } });
    });
    expect(svc.services.aiResultsService.setSelectedAIResult).toHaveBeenCalledWith(
      'study-1',
      'sr-2',
      expect.anything()
    );
  });

  it('Next navigates AI results via setSelectedAIResult', async () => {
    mockAuthReturn = [{ user: { profile: { sub: 'u1' } } }];
    const svc = services();
    await renderPanel(svc);
    await act(async () => {
      fireEvent.click(screen.getByTitle('Next AI Result'));
    });
    expect(svc.services.aiResultsService.setSelectedAIResult).toHaveBeenCalledWith(
      'study-1',
      'sr-2',
      expect.anything()
    );
  });

  it('prefills and locks the form when the backend reports the user already submitted', async () => {
    mockAuthReturn = [{ user: { profile: { sub: 'rad-7' } } }];
    const svc = services();
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ users: [{ user_id: 'rad-7', verdict_L: 1, verdict_R: -1 }] }),
      text: async () => '',
    });
    await renderPanel(svc);
    await waitFor(() => expect(screen.getByText('Submitted')).toBeTruthy());
    expect(screen.getByText('Edit Feedback')).toBeTruthy();
  });

  it('unsubscribes from AI selection events on unmount', async () => {
    mockAuthReturn = [{ user: { profile: { sub: 'u1' } } }];
    const unsubscribe = jest.fn();
    const svc = services();
    svc.services.aiResultsService.subscribe = jest.fn(() => ({ unsubscribe }));
    const { unmount } = await renderPanel(svc);
    expect(svc.services.aiResultsService.subscribe).toHaveBeenCalledWith('sel', expect.any(Function));
    unmount();
    expect(unsubscribe).toHaveBeenCalled();
  });
});
