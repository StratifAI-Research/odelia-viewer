import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { makeServicesManager, withSystem } from '../../test-utils/harness';

// The panel consumes the streaming chat hook; inject its surface directly so we
// drive each render branch and assert the panel forwards the right payloads.
const hookState: any = {};
const sendMessage = jest.fn();
const cancelGeneration = jest.fn();
const clearHistory = jest.fn();
const connect = jest.fn();

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
    disconnect: jest.fn(),
    ...over,
  });
}

jest.mock('../../hooks/useChatService', () => ({
  useChatService: () => hookState,
}));

// useImageViewer / useViewportGrid are stubbed by the module mocks; the panel
// only reads StudyInstanceUIDs + the active viewport map from them.
import ChatPanel from './ChatPanel';

const msg = (over: any = {}) => ({
  id: `m-${Math.random()}`,
  role: 'assistant',
  content: 'hello',
  timestamp: new Date('2024-03-15T10:00:00Z'),
  ...over,
});

// jsdom lacks scrollIntoView; the panel calls it on every messages change.
// Swallow only the environmental ReactDOMTestUtils.act deprecation; re-emit
// every other console.error so real failures still surface.
const realError = console.error;
beforeAll(() => {
  (Element.prototype as any).scrollIntoView = jest.fn();
  (HTMLElement.prototype as any).focus = jest.fn();
  jest.spyOn(console, 'error').mockImplementation((...args: any[]) => {
    if (typeof args[0] === 'string' && args[0].includes('ReactDOMTestUtils.act')) {
      return;
    }
    realError(...args);
  });
});
afterAll(() => {
  (console.error as jest.Mock).mockRestore();
});

beforeEach(() => {
  jest.clearAllMocks();
  setHook();
  withSystem(makeServicesManager());
});

describe('ChatPanel', () => {
  it('renders the empty state when there are no messages', () => {
    render(<ChatPanel />);
    expect(screen.getByText('No messages yet')).toBeTruthy();
    // Connected: header shows a truncated session id, not "Disconnected".
    expect(screen.getByText(/Session: session-/)).toBeTruthy();
  });

  it('renders the disconnected banner with a reconnect button when not connected', () => {
    setHook({ isConnected: false });
    render(<ChatPanel />);
    // "Disconnected" shows in both the header and the banner.
    expect(screen.getAllByText('Disconnected').length).toBeGreaterThanOrEqual(1);
    const reconnect = screen.getByText('Reconnect');
    fireEvent.click(reconnect);
    expect(connect).toHaveBeenCalledTimes(1);
    // Input is disabled while disconnected.
    const textarea = screen.getByPlaceholderText('Connecting...') as HTMLTextAreaElement;
    expect(textarea.disabled).toBe(true);
  });

  it('sends a typed message: forwards trimmed content to the service and clears the input', () => {
    render(<ChatPanel />);
    const textarea = screen.getByPlaceholderText('Ask about this study...') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: '  what is this lesion?  ' } });
    expect(textarea.value).toBe('  what is this lesion?  ');
    fireEvent.click(screen.getByTitle('Send'));
    expect(sendMessage).toHaveBeenCalledTimes(1);
    // trimmed content, no study/series context resolved in the default harness
    expect(sendMessage).toHaveBeenCalledWith('what is this lesion?', undefined, undefined);
    expect(textarea.value).toBe('');
  });

  it('sends on Enter and suppresses send on Shift+Enter', () => {
    render(<ChatPanel />);
    const textarea = screen.getByPlaceholderText('Ask about this study...') as HTMLTextAreaElement;
    fireEvent.change(textarea, { target: { value: 'hi' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(sendMessage).not.toHaveBeenCalled();
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(sendMessage).toHaveBeenCalledWith('hi', undefined, undefined);
  });

  it('disables the send button for empty/whitespace input', () => {
    render(<ChatPanel />);
    const send = screen.getByTitle('Send') as HTMLButtonElement;
    expect(send.disabled).toBe(true);
    const textarea = screen.getByPlaceholderText('Ask about this study...');
    fireEvent.change(textarea, { target: { value: '   ' } });
    expect((screen.getByTitle('Send') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(textarea, { target: { value: 'real' } });
    expect((screen.getByTitle('Send') as HTMLButtonElement).disabled).toBe(false);
  });

  it('renders a user message and an assistant message with markdown', () => {
    setHook({
      messages: [
        msg({ id: 'u1', role: 'user', content: 'Hello there' }),
        msg({ id: 'a1', role: 'assistant', content: '**bold** answer' }),
      ],
    });
    const { container } = render(<ChatPanel />);
    expect(screen.getByText('Hello there')).toBeTruthy();
    // marked converts **bold** to a <strong> element for assistant content.
    expect(container.querySelector('strong')?.textContent).toBe('bold');
    expect(screen.queryByText('No messages yet')).toBeNull();
  });

  it('shows the streaming state: cancel button replaces send and streaming status renders', () => {
    setHook({
      isStreaming: true,
      preprocessingStatus: 'Preprocessing slices',
      preprocessingProgress: 0.5,
      messages: [msg({ id: 's1', role: 'assistant', content: '', isStreaming: true })],
    });
    render(<ChatPanel />);
    // Cancel button shown instead of send while streaming.
    const cancel = screen.getByTitle('Cancel');
    fireEvent.click(cancel);
    expect(cancelGeneration).toHaveBeenCalledTimes(1);
    expect(screen.queryByTitle('Send')).toBeNull();
    expect(screen.getByText('Preprocessing slices')).toBeTruthy();
  });

  it('does not send while streaming even with non-empty input', () => {
    setHook({ isStreaming: true });
    render(<ChatPanel />);
    const textarea = screen.getByPlaceholderText('Ask about this study...');
    fireEvent.change(textarea, { target: { value: 'queued?' } });
    // No send button while streaming; pressing Enter must not call sendMessage.
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('renders the service error banner when error is set', () => {
    setHook({ error: 'Connection lost' });
    render(<ChatPanel />);
    expect(screen.getByText('Connection lost')).toBeTruthy();
  });

  it('clears history via the Clear button; disabled when there are no messages', () => {
    render(<ChatPanel />);
    const clear = screen.getByTitle('Clear history') as HTMLButtonElement;
    expect(clear.disabled).toBe(true);
    setHook({ messages: [msg({ id: 'a1', content: 'x' })] });
    render(<ChatPanel />);
    const clears = screen.getAllByTitle('Clear history') as HTMLButtonElement[];
    const enabled = clears.find(b => !b.disabled)!;
    fireEvent.click(enabled);
    expect(clearHistory).toHaveBeenCalledTimes(1);
  });

  it('opens the settings modal and loads config from the debug API', async () => {
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
    render(<ChatPanel />);
    await act(async () => {
      fireEvent.click(screen.getByTitle('Settings'));
    });
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/debug/config'));
    expect(screen.getByText('Chat Settings')).toBeTruthy();
    expect((screen.getByDisplayValue('You are helpful') as HTMLTextAreaElement)).toBeTruthy();
    expect((screen.getByDisplayValue('medgemma') as HTMLInputElement)).toBeTruthy();
  });

  it('expands the context selector and reports no series available by default', () => {
    render(<ChatPanel />);
    fireEvent.click(screen.getByText('No series selected'));
    expect(screen.getByText('No series available')).toBeTruthy();
  });
});
