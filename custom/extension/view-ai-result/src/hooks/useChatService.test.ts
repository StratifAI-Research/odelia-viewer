import { renderHook, act } from '@testing-library/react';
import { useChatService } from './useChatService';
import { CHAT_EVENTS } from '../types/chatTypes';
import { withSystem, makeServicesManager } from '../test-utils/harness';

// Fake ChatService: records subscriptions, exposes emit + spy actions.
function makeChatService(overrides: any = {}) {
  const handlers: Record<string, Array<(d: any) => void>> = {};
  const unsubscribes: jest.Mock[] = [];
  return {
    connect: jest.fn(async () => 'session-1'),
    disconnect: jest.fn(),
    sendMessage: jest.fn(),
    cancelGeneration: jest.fn(),
    subscribe: jest.fn((event: string, cb: (d: any) => void) => {
      (handlers[event] ||= []).push(cb);
      const unsubscribe = jest.fn();
      unsubscribes.push(unsubscribe);
      return { unsubscribe };
    }),
    unsubscribes,
    emit(event: string, data: any) {
      (handlers[event] || []).forEach(cb => cb(data));
    },
    ...overrides,
  };
}

function setup(chatService: any) {
  withSystem(makeServicesManager({ services: { chatService } }));
  return renderHook(() => useChatService());
}

describe('useChatService', () => {
  it('exposes initial empty state', () => {
    const chatService = makeChatService();
    const { result } = setup(chatService);
    expect(result.current.messages).toEqual([]);
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.error).toBeNull();
    expect(result.current.preprocessingStatus).toBeNull();
  });

  it('subscribes to all chat events on mount and unsubscribes on unmount', () => {
    const chatService = makeChatService();
    const { unmount } = setup(chatService);
    const events = chatService.subscribe.mock.calls.map((c: any[]) => c[0]);
    expect(events).toEqual(
      expect.arrayContaining([
        CHAT_EVENTS.CONNECTED,
        CHAT_EVENTS.DISCONNECTED,
        CHAT_EVENTS.TOKEN,
        CHAT_EVENTS.THINKING_TOKEN,
        CHAT_EVENTS.MESSAGE_COMPLETE,
        CHAT_EVENTS.ERROR,
        CHAT_EVENTS.PREPROCESSING,
      ])
    );
    const count = chatService.unsubscribes.length;
    expect(count).toBeGreaterThan(0);
    unmount();
    chatService.unsubscribes.forEach((u: jest.Mock) => expect(u).toHaveBeenCalledTimes(1));
  });

  it('auto-connects on mount and reflects connection state', async () => {
    const chatService = makeChatService();
    const { result } = setup(chatService);
    await act(async () => {});
    expect(chatService.connect).toHaveBeenCalled();
    expect(result.current.isConnected).toBe(true);
    expect(result.current.sessionId).toBe('session-1');
  });

  it('updates state from a CONNECTED event', () => {
    const chatService = makeChatService();
    const { result } = setup(chatService);
    act(() => chatService.emit(CHAT_EVENTS.CONNECTED, { sessionId: 'evt-session' }));
    expect(result.current.isConnected).toBe(true);
    expect(result.current.sessionId).toBe('evt-session');
  });

  it('sets error and stops streaming from an ERROR event', () => {
    const chatService = makeChatService();
    const { result } = setup(chatService);
    act(() => chatService.emit(CHAT_EVENTS.ERROR, { error: 'boom' }));
    expect(result.current.error).toBe('boom');
    expect(result.current.isStreaming).toBe(false);
  });

  it('sendMessage appends user + assistant messages and forwards to the service', () => {
    const chatService = makeChatService();
    const { result } = setup(chatService);
    act(() => result.current.sendMessage('hello', 's1', ['se1']));
    expect(chatService.sendMessage).toHaveBeenCalledWith('hello', 's1', ['se1']);
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0]).toMatchObject({ role: 'user', content: 'hello' });
    expect(result.current.messages[1]).toMatchObject({ role: 'assistant', isStreaming: true });
    expect(result.current.isStreaming).toBe(true);
  });

  it('streams TOKEN content into the active assistant message', () => {
    const chatService = makeChatService();
    const { result } = setup(chatService);
    act(() => result.current.sendMessage('hi'));
    act(() => chatService.emit(CHAT_EVENTS.TOKEN, { content: 'Hel' }));
    act(() => chatService.emit(CHAT_EVENTS.TOKEN, { content: 'lo' }));
    const assistant = result.current.messages[1];
    expect(assistant.content).toBe('Hello');
  });

  it('MESSAGE_COMPLETE clears streaming flags', () => {
    const chatService = makeChatService();
    const { result } = setup(chatService);
    act(() => result.current.sendMessage('hi'));
    act(() => chatService.emit(CHAT_EVENTS.MESSAGE_COMPLETE, {}));
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.messages[1].isStreaming).toBe(false);
  });

  it('PREPROCESSING event surfaces status and progress', () => {
    const chatService = makeChatService();
    const { result } = setup(chatService);
    act(() => chatService.emit(CHAT_EVENTS.PREPROCESSING, { status: 'loading', progress: 42 }));
    expect(result.current.preprocessingStatus).toBe('loading');
    expect(result.current.preprocessingProgress).toBe(42);
  });

  it('clearHistory empties the message list', () => {
    const chatService = makeChatService();
    const { result } = setup(chatService);
    act(() => result.current.sendMessage('hi'));
    expect(result.current.messages.length).toBeGreaterThan(0);
    act(() => result.current.clearHistory());
    expect(result.current.messages).toEqual([]);
  });

  // --- consistent stream cleanup across teardown paths ---

  it('DISCONNECTED finalizes an in-flight streaming message', () => {
    const chatService = makeChatService();
    const { result } = setup(chatService);
    act(() => result.current.sendMessage('hi'));
    act(() => chatService.emit(CHAT_EVENTS.TOKEN, { content: 'partial' }));
    expect(result.current.messages[1].isStreaming).toBe(true);

    // Socket drops mid-stream: the placeholder must not stay stuck streaming.
    act(() => chatService.emit(CHAT_EVENTS.DISCONNECTED, {}));
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.messages[1].isStreaming).toBe(false);
    expect(result.current.messages[1].content).toBe('partial');
  });

  it('clearHistory cancels backend generation and clears streaming state', () => {
    const chatService = makeChatService();
    const { result } = setup(chatService);
    act(() => result.current.sendMessage('hi'));
    expect(result.current.isStreaming).toBe(true);
    act(() => result.current.clearHistory());
    expect(chatService.cancelGeneration).toHaveBeenCalled();
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.messages).toEqual([]);
  });

  it('cancelGeneration finalizes the streaming message with a cancelled marker', () => {
    const chatService = makeChatService();
    const { result } = setup(chatService);
    act(() => result.current.sendMessage('hi'));
    act(() => chatService.emit(CHAT_EVENTS.TOKEN, { content: 'abc' }));
    act(() => result.current.cancelGeneration());
    expect(chatService.cancelGeneration).toHaveBeenCalled();
    expect(result.current.isStreaming).toBe(false);
    expect(result.current.messages[1].isStreaming).toBe(false);
    expect(result.current.messages[1].content).toBe('abc [cancelled]');
  });

  it('a late TOKEN after teardown is dropped (streaming refs reset)', () => {
    const chatService = makeChatService();
    const { result } = setup(chatService);
    act(() => result.current.sendMessage('hi'));
    act(() => chatService.emit(CHAT_EVENTS.DISCONNECTED, {}));
    // The stream ref was cleared by finishStream, so a straggler token must not
    // reopen or mutate the finalized message.
    act(() => chatService.emit(CHAT_EVENTS.TOKEN, { content: 'late' }));
    expect(result.current.messages[1].content).toBe('');
    expect(result.current.messages[1].isStreaming).toBe(false);
  });

  it('sets an error when no chat service is available', () => {
    withSystem(makeServicesManager({ services: { chatService: undefined } }));
    const { result } = renderHook(() => useChatService());
    act(() => {
      result.current.connect();
    });
    expect(result.current.error).toBe('Chat service not available');
  });
});
