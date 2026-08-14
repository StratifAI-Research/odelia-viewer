import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import {
  installConsoleErrorFilter,
  makeServicesManager,
  withSystem,
} from '../../test-utils/harness';

// useImageViewer / useViewportGrid are stubbed by the module mocks; the panel
// only reads StudyInstanceUIDs + the active viewport map from them.
import ChatPanel from './ChatPanel';

// The panel consumes the streaming chat hook; inject its surface directly so we
// drive each render branch and assert the panel forwards the right payloads.
const hookState: any = {};
const sendMessage = jest.fn();
const cancelGeneration = jest.fn();
const clearHistory = jest.fn();
const connect = jest.fn();
const appendEvent = jest.fn();

function setHook(over: Partial<typeof hookState> = {}) {
  Object.assign(hookState, {
    messages: [],
    isConnected: true,
    isStreaming: false,
    error: null,
    sessionId: 'session-abcdef01',
    preprocessingStatus: null,
    preprocessingProgress: null,
    connect,
    sendMessage,
    cancelGeneration,
    clearHistory,
    appendEvent,
    switchSession: jest.fn().mockResolvedValue('session-abcdef01'),
    hydrateMessages: jest.fn(),
    disconnect: jest.fn(),
    ...over,
  });
}

jest.mock('../../hooks/useChatService', () => ({
  useChatService: () => hookState,
}));

let msgSeq = 0;
const msg = (over: any = {}) => ({
  id: `m-${++msgSeq}`,
  role: 'assistant',
  content: 'hello',
  timestamp: new Date('2024-03-15T10:00:00Z'),
  ...over,
});

// jsdom lacks scrollIntoView; the panel calls it on every messages change.
// Swallow only the environmental ReactDOMTestUtils.act deprecation; re-emit
// every other console.error so real failures still surface.
installConsoleErrorFilter();
beforeAll(() => {
  (Element.prototype as any).scrollIntoView = jest.fn();
  (HTMLElement.prototype as any).focus = jest.fn();
});

beforeEach(() => {
  jest.clearAllMocks();
  // Chat threads persist in sessionStorage; clear so cases stay independent.
  window.sessionStorage.clear();
  setHook();
  withSystem(makeServicesManager());
  // The panel reads the debug config on mount to show the active model in the
  // header, so every render needs a fetch to resolve against.
  (global as any).fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
});

/** Mount the panel, flushing the mount-time config load. */
async function renderPanel() {
  await act(async () => {
    render(<ChatPanel />);
  });
}

/** Open the header's overflow menu, where session/settings/clear now live. */
function openOverflow() {
  fireEvent.click(screen.getByTitle('More options'));
}

const COMPOSER = 'Ask about these images...';

describe('ChatPanel', () => {
  it('renders the empty state when there are no messages', async () => {
    await renderPanel();
    expect(screen.getByText('No messages yet')).toBeTruthy();
    expect(screen.getByText('AI Assistant')).toBeTruthy();
  });

  it('keeps the session id out of the primary UI, behind the overflow menu', async () => {
    // Audit detail, not clinical information — it used to consume a permanent
    // header row for no day-to-day benefit.
    await renderPanel();
    expect(screen.queryByText(/Session: /)).toBeNull();
    openOverflow();
    expect(screen.getByText(/Session: session-abcdef01/)).toBeTruthy();
  });

  it('renders the disconnected banner with a reconnect button when not connected', async () => {
    setHook({ isConnected: false });
    await renderPanel();
    expect(screen.getByText('Disconnected')).toBeTruthy();
    fireEvent.click(screen.getByText('Reconnect'));
    expect(connect).toHaveBeenCalledTimes(1);
    // Input is disabled while disconnected.
    const textarea = screen.getByPlaceholderText('Connecting...') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });

  it('sends a typed message: forwards trimmed content plus a context snapshot', async () => {
    await renderPanel();
    const textarea = screen.getByPlaceholderText(COMPOSER) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '  what is this lesion?  ' } });
    expect(textarea.value).toBe('  what is this lesion?  ');
    fireEvent.click(screen.getByTitle('Send'));

    expect(sendMessage).toHaveBeenCalledTimes(1);
    // Trimmed content; no study/series resolved in the default harness. The
    // fourth argument is the immutable snapshot the message is stamped with.
    expect(sendMessage).toHaveBeenCalledWith(
      'what is this lesion?',
      undefined,
      undefined,
      expect.objectContaining({ series: [], provider: 'local', requestedImageCount: 0 })
    );
    expect(textarea.value).toBe('');
  });

  it('sends on Enter and suppresses send on Shift+Enter', async () => {
    await renderPanel();
    const textarea = screen.getByPlaceholderText(COMPOSER) as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hi' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(sendMessage).not.toHaveBeenCalled();
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(sendMessage).toHaveBeenCalledWith('hi', undefined, undefined, expect.any(Object));
  });

  it('disables the send button for empty/whitespace input', async () => {
    await renderPanel();
    const send = screen.getByTitle('Send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    const textarea = screen.getByPlaceholderText(COMPOSER);
    fireEvent.change(textarea, { target: { value: '   ' } });
    expect((screen.getByTitle('Send') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(textarea, { target: { value: 'real' } });
    expect((screen.getByTitle('Send') as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders a user message and an assistant message with markdown', async () => {
    setHook({
      messages: [
        msg({ id: 'u1', role: 'user', content: 'Hello there' }),
        msg({ id: 'a1', role: 'assistant', content: '**bold** answer' }),
      ],
    });
    await renderPanel();
    expect(screen.getByText('Hello there')).toBeTruthy();
    // marked converts **bold** to a <strong> element for assistant content.
    expect(document.querySelector('strong')?.textContent).toBe('bold');
    expect(screen.queryByText('No messages yet')).toBeNull();
    // Turns are labelled rather than distinguished only by alignment.
    expect(screen.getByText('You')).toBeTruthy();
    expect(screen.getByText('AI')).toBeTruthy();
  });

  it('renders a transcript event as an annotation, not as a turn', async () => {
    // A mid-conversation model change has to stay visible in scrollback, but it
    // is not something a participant said.
    setHook({
      messages: [
        msg({ id: 'a1', role: 'assistant', content: 'first answer' }),
        msg({ id: 'e1', role: 'event', content: 'Model changed to MiniMax M3' }),
      ],
    });
    await renderPanel();
    expect(screen.getByText('Model changed to MiniMax M3')).toBeTruthy();
    // Exactly one "AI" label: the event must not be rendered as an assistant turn.
    expect(screen.getAllByText('AI')).toHaveLength(1);
  });

  it('shows the streaming state: cancel button replaces send and streaming status renders', async () => {
    setHook({
      isStreaming: true,
      preprocessingStatus: 'Preprocessing slices',
      preprocessingProgress: 0.5,
      messages: [msg({ id: 's1', role: 'assistant', content: '', isStreaming: true })],
    });
    await renderPanel();
    fireEvent.click(screen.getByTitle('Cancel'));
    expect(cancelGeneration).toHaveBeenCalledTimes(1);
    expect(screen.queryByTitle('Send')).toBeNull();
    expect(screen.getByText('Preprocessing slices')).toBeTruthy();
  });

  it('does not send while streaming even with non-empty input', async () => {
    setHook({ isStreaming: true });
    await renderPanel();
    const textarea = screen.getByPlaceholderText(COMPOSER);
    fireEvent.change(textarea, { target: { value: 'queued?' } });
    // No send button while streaming; pressing Enter must not call sendMessage.
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('renders the service error banner when error is set', async () => {
    setHook({ error: 'Connection lost' });
    await renderPanel();
    expect(screen.getByText('Connection lost')).toBeTruthy();
  });

  it('clears history from the overflow menu; disabled when there are no messages', async () => {
    await renderPanel();
    openOverflow();
    expect((screen.getByTitle('Clear history') as HTMLButtonElement).disabled).toBe(true);

    setHook({ messages: [msg({ id: 'a1', content: 'x' })] });
    await renderPanel();
    const clears = screen.getAllByTitle('Clear history') as HTMLButtonElement[];
    // Two panels are mounted by this point; drive the one that is enabled.
    fireEvent.click(screen.getAllByTitle('More options')[1]);
    const enabled = (screen.getAllByTitle('Clear history') as HTMLButtonElement[]).find(
      b => !b.disabled
    );
    expect(clears.length).toBeGreaterThan(0);
    fireEvent.click(enabled!);
    expect(clearHistory).toHaveBeenCalledTimes(1);
  });

  it('opens the settings modal from the overflow menu and loads config', async () => {
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        system_prompt: 'You are helpful',
        model: 'medgemma',
        preprocessing: { num_slices: 7, slice_strategy: 'uniform', central_percentage: 80 },
        ollama_options: { think: true, suffix: 'end' },
      }),
    });
    (global as any).fetch = fetchMock;
    await renderPanel();
    openOverflow();
    await act(async () => {
      fireEvent.click(screen.getByTitle('Settings'));
    });
    // Uses the same-origin nginx route (jsdom's hostname is `localhost`).
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/chat-api/debug/config'));
    expect(screen.getByText('Chat Settings')).toBeTruthy();
    expect(screen.getByDisplayValue('You are helpful') as HTMLTextAreaElement).toBeTruthy();
    expect(screen.getByDisplayValue('medgemma') as HTMLInputElement).toBeTruthy();
  });

  it('shows the active model in the header, condensed', async () => {
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ model: 'thiagomoraes/medgemma-1.5-4b-it:Q4_K_M' }),
    });
    await renderPanel();
    // The header carries the short name; the full tag is in the dropdown.
    expect(screen.getByTitle('Model').textContent).toContain('MedGemma 1.5');
    fireEvent.click(screen.getByTitle('Model'));
    expect(screen.getByText('thiagomoraes/medgemma-1.5-4b-it:Q4_K_M')).toBeTruthy();
  });

  it('reports plainly when no study is open in the viewer', async () => {
    // The default harness resolves no study, so the prompt context has nothing
    // to attach — it must say so rather than look empty-but-ready.
    await renderPanel();
    expect(screen.getByText('Prompt context')).toBeTruthy();
    expect(screen.getByText('No study open in the viewer.')).toBeTruthy();
  });
});
