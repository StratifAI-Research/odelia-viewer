/**
 * useChatService - React hook for interacting with ChatService
 * Manages chat state, message history, and streaming
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useSystem } from '@ohif/core';
import {
  ChatMessage,
  CHAT_EVENTS,
  PromptContextSnapshot,
  WireSliceSelection,
} from '../types/chatTypes';
import { ChatService } from '../services/ChatService';

// Generate unique message IDs
let messageIdCounter = 0;
const generateMessageId = () => `msg-${Date.now()}-${++messageIdCounter}`;

interface UseChatServiceReturn {
  // State
  messages: ChatMessage[];
  isConnected: boolean;
  isStreaming: boolean;
  error: string | null;
  sessionId: string | null;
  preprocessingStatus: string | null;
  preprocessingProgress: number | null;

  // Actions
  connect: () => Promise<void>;
  disconnect: () => void;
  sendMessage: (
    content: string,
    studyUID?: string,
    seriesUIDs?: string[],
    promptContext?: PromptContextSnapshot,
    sliceSelections?: WireSliceSelection[]
  ) => void;
  cancelGeneration: () => void;
  clearHistory: () => void;
  /** Insert a transcript annotation (e.g. a mid-conversation model change). */
  appendEvent: (content: string) => void;
  /** Join another middleware session (`'new'` for a fresh one). */
  switchSession: (sessionId: string) => Promise<string | null>;
  /** Replace the displayed transcript, e.g. when switching chat threads. */
  hydrateMessages: (messages: ChatMessage[]) => void;
}

export function useChatService(): UseChatServiceReturn {
  const { servicesManager } = useSystem();
  const chatService = servicesManager?.services?.chatService as ChatService | undefined;

  // State
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isConnected, setIsConnected] = useState(false);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [preprocessingStatus, setPreprocessingStatus] = useState<string | null>(null);
  const [preprocessingProgress, setPreprocessingProgress] = useState<number | null>(null);

  // Ref to track current streaming message
  const currentStreamingMessageRef = useRef<string | null>(null);
  const streamingContentRef = useRef<string>('');
  const streamingThinkingRef = useRef<string>('');
  const rawStreamingRef = useRef<string>('');
  const hasReceivedThinkingTokenRef = useRef<boolean>(false);

  // Model-specific sentinels the chat middleware wraps around the
  // model's chain-of-thought so we can split "thinking" from the visible answer.
  // These match the tokens the current model emits; a model/middleware change
  // that alters them will silently break thinking extraction (the text will just
  // render inline). Keep these in sync with the deployed chat model.
  const THINK_START_MARKER = '<unused94>thought';
  const THINK_END_MARKER = '<unused95>';

  const splitThinkingFromContent = useCallback((raw: string) => {
    let visibleText = raw;
    let thinkingText = '';

    const startIdx = raw.indexOf(THINK_START_MARKER);
    if (startIdx === -1) {
      return { visibleText, thinkingText };
    }

    const afterStart = startIdx + THINK_START_MARKER.length;
    const endIdx = raw.indexOf(THINK_END_MARKER, afterStart);

    if (endIdx === -1) {
      // We are inside the thinking section but haven't seen the end marker yet
      const rawThinking = raw.slice(afterStart);
      thinkingText = rawThinking;
      visibleText = raw.slice(0, startIdx);
      return { visibleText, thinkingText };
    }

    const rawThinking = raw.slice(afterStart, endIdx);
    // Strip optional “Thinking Process:” label and surrounding whitespace
    const cleanedThinking = rawThinking.replace(/^\s*Thinking Process:\s*/i, '').trim();

    thinkingText = cleanedThinking;
    visibleText = raw.slice(0, startIdx) + raw.slice(endIdx + THINK_END_MARKER.length);

    return { visibleText, thinkingText };
  }, []);

  // Reset the per-stream scratch refs. Safe to call from any teardown path.
  const resetStreamingRefs = useCallback(() => {
    currentStreamingMessageRef.current = null;
    streamingContentRef.current = '';
    streamingThinkingRef.current = '';
    rawStreamingRef.current = '';
    hasReceivedThinkingTokenRef.current = false;
  }, []);

  // Finalize the in-flight assistant placeholder (if any) and clear streaming
  // state. Called from every path that ends a stream (done, cancel, clear, error,
  // disconnect). `mutate` can adjust the finalized message (append a marker,
  // backfill error text).
  const finishStream = useCallback(
    (mutate?: (msg: ChatMessage) => ChatMessage) => {
      const messageId = currentStreamingMessageRef.current;
      resetStreamingRefs();
      setIsStreaming(false);
      if (!messageId) {
        return;
      }
      setMessages(prev =>
        prev.map(msg => {
          if (msg.id !== messageId) {
            return msg;
          }
          const finalized: ChatMessage = { ...msg, isStreaming: false };
          return mutate ? mutate(finalized) : finalized;
        })
      );
    },
    [resetStreamingRefs]
  );

  // Connect to WebSocket
  const connect = useCallback(async () => {
    if (!chatService) {
      setError('Chat service not available');
      return;
    }

    try {
      setError(null);
      const id = await chatService.connect();
      setSessionId(id);
      setIsConnected(true);
    } catch (e: any) {
      setError(e?.message || 'Failed to connect');
      setIsConnected(false);
    }
  }, [chatService]);

  // Disconnect from WebSocket
  const disconnect = useCallback(() => {
    if (!chatService) {
      return;
    }
    chatService.disconnect();
    setIsConnected(false);
    setSessionId(null);
    finishStream();
  }, [chatService, finishStream]);

  // Send a message
  const sendMessage = useCallback(
    (
      content: string,
      studyUID?: string,
      seriesUIDs?: string[],
      promptContext?: PromptContextSnapshot,
      sliceSelections?: WireSliceSelection[]
    ) => {
      if (!chatService || !content.trim()) {
        return;
      }

      // Clear any previous error
      setError(null);
      setPreprocessingStatus(null);
      setPreprocessingProgress(null);

      // Add user message to history
      const userMessage: ChatMessage = {
        id: generateMessageId(),
        role: 'user',
        content: content.trim(),
        timestamp: new Date(),
        seriesContext: seriesUIDs,
        promptContext,
      };
      setMessages(prev => [...prev, userMessage]);

      // Create placeholder for assistant response. It carries the same snapshot
      // as the question: the answer was produced from exactly that context, so
      // either side can be traced without walking the transcript.
      const assistantMessageId = generateMessageId();
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
        promptContext,
      };
      setMessages(prev => [...prev, assistantMessage]);

      // Track streaming state
      currentStreamingMessageRef.current = assistantMessageId;
      streamingContentRef.current = '';
      streamingThinkingRef.current = '';
      rawStreamingRef.current = '';
      hasReceivedThinkingTokenRef.current = false;
      setIsStreaming(true);

      // Send to service. The slice selection travels on the wire; the snapshot
      // above records the same choice for the transcript, so the two are built
      // from one state read at the call site rather than derived twice.
      chatService.sendMessage(content.trim(), studyUID, seriesUIDs, sliceSelections);
    },
    [chatService]
  );

  // Cancel current generation
  const cancelGeneration = useCallback(() => {
    if (!chatService) {
      return;
    }
    chatService.cancelGeneration();
    finishStream(msg => ({ ...msg, content: msg.content + ' [cancelled]' }));
  }, [chatService, finishStream]);

  // Join another conversation. The middleware owns what the model remembers
  // (keyed by session id); the caller owns what is displayed and hydrates it
  // separately, because the transcript the panel shows carries per-message
  // provenance the server does not store.
  const switchSession = useCallback(
    async (targetSessionId: string) => {
      if (!chatService) {
        setError('Chat service not available');
        return null;
      }
      // Whatever was streaming belongs to the conversation being left.
      chatService.cancelGeneration();
      resetStreamingRefs();
      setIsStreaming(false);
      setPreprocessingStatus(null);
      setPreprocessingProgress(null);
      setError(null);
      try {
        const id = await chatService.switchSession(targetSessionId);
        setSessionId(id);
        setIsConnected(true);
        return id;
      } catch (e: any) {
        setError(e?.message || 'Failed to switch chat');
        setIsConnected(false);
        return null;
      }
    },
    [chatService, resetStreamingRefs]
  );

  // Replace the displayed transcript wholesale (thread switch / restore).
  const hydrateMessages = useCallback(
    (next: ChatMessage[]) => {
      resetStreamingRefs();
      setIsStreaming(false);
      setPreprocessingStatus(null);
      setPreprocessingProgress(null);
      setMessages(next);
    },
    [resetStreamingRefs]
  );

  // Insert a transcript annotation. Purely local: the middleware holds the
  // conversation history and must not be told these are user turns, so this
  // deliberately does NOT call chatService. Its only job is to keep a
  // configuration change visible in scrollback, so that two answers produced by
  // different models remain distinguishable after the fact.
  const appendEvent = useCallback((content: string) => {
    if (!content.trim()) {
      return;
    }
    setMessages(prev => [
      ...prev,
      {
        id: generateMessageId(),
        role: 'event',
        content: content.trim(),
        timestamp: new Date(),
      },
    ]);
  }, []);

  // Clear message history
  const clearHistory = useCallback(() => {
    // Cancel in-flight generation first so no more tokens arrive for the dropped
    // messages, then clear the list and streaming state.
    chatService?.cancelGeneration();
    setMessages([]);
    setError(null);
    setPreprocessingStatus(null);
    setPreprocessingProgress(null);
    resetStreamingRefs();
    setIsStreaming(false);
  }, [chatService, resetStreamingRefs]);

  // Subscribe to service events
  useEffect(() => {
    if (!chatService) {
      return;
    }

    const subscriptions: Array<{ unsubscribe: () => void }> = [];

    // Connected event
    subscriptions.push(
      chatService.subscribe(CHAT_EVENTS.CONNECTED, data => {
        setIsConnected(true);
        setSessionId(data.sessionId);
        setError(null);
      })
    );

    // Disconnected event
    subscriptions.push(
      chatService.subscribe(CHAT_EVENTS.DISCONNECTED, () => {
        setIsConnected(false);
        setSessionId(null);
        // Finalize any message still marked streaming — no more frames will arrive.
        finishStream();
      })
    );

    // Token event - append to current streaming message
    subscriptions.push(
      chatService.subscribe(CHAT_EVENTS.TOKEN, data => {
        if (currentStreamingMessageRef.current && data.content) {
          // Clear preprocessing status on first token (transition to generating)
          if (rawStreamingRef.current.length === 0) {
            setPreprocessingStatus(null);
            setPreprocessingProgress(null);
          }
          rawStreamingRef.current += data.content;

          if (hasReceivedThinkingTokenRef.current) {
            // Backend is separating thinking via dedicated channel -- use content as-is
            streamingContentRef.current = rawStreamingRef.current;
          } else {
            // Legacy fallback: parse thinking markers from the content stream
            const { visibleText, thinkingText } = splitThinkingFromContent(rawStreamingRef.current);
            streamingContentRef.current = visibleText;
            streamingThinkingRef.current = thinkingText;
          }

          setMessages(prev =>
            prev.map(msg =>
              msg.id === currentStreamingMessageRef.current
                ? {
                    ...msg,
                    content: streamingContentRef.current,
                    thinking: streamingThinkingRef.current || undefined,
                  }
                : msg
            )
          );
        }
      })
    );

    // Thinking token event - dedicated thinking/reasoning channel from backend
    subscriptions.push(
      chatService.subscribe(CHAT_EVENTS.THINKING_TOKEN, data => {
        if (currentStreamingMessageRef.current && data.content) {
          hasReceivedThinkingTokenRef.current = true;
          // Clear preprocessing status on first thinking token too
          if (rawStreamingRef.current.length === 0 && streamingThinkingRef.current.length === 0) {
            setPreprocessingStatus(null);
            setPreprocessingProgress(null);
          }
          streamingThinkingRef.current += data.content;
          setMessages(prev =>
            prev.map(msg =>
              msg.id === currentStreamingMessageRef.current
                ? { ...msg, thinking: streamingThinkingRef.current }
                : msg
            )
          );
        }
      })
    );

    // Message complete event
    subscriptions.push(
      chatService.subscribe(CHAT_EVENTS.MESSAGE_COMPLETE, () => {
        finishStream();
        setPreprocessingStatus(null);
        setPreprocessingProgress(null);
      })
    );

    // Error event
    subscriptions.push(
      chatService.subscribe(CHAT_EVENTS.ERROR, data => {
        setError(data.error || 'Unknown error');
        setPreprocessingStatus(null);
        setPreprocessingProgress(null);
        // Finalize the placeholder, backfilling error text only if nothing streamed.
        finishStream(msg => ({
          ...msg,
          content: msg.content || `Error: ${data.error}`,
        }));
      })
    );

    // Preprocessing event
    subscriptions.push(
      chatService.subscribe(CHAT_EVENTS.PREPROCESSING, data => {
        setPreprocessingStatus(data.status);
        setPreprocessingProgress(data.progress ?? null);
      })
    );

    // Cleanup subscriptions
    return () => {
      subscriptions.forEach(sub => sub.unsubscribe());
    };
  }, [chatService, finishStream, splitThinkingFromContent]);

  // Auto-connect on mount if service available
  useEffect(() => {
    if (chatService && !isConnected) {
      connect();
    }

    // Cleanup on unmount
    return () => {
      if (chatService) {
        // Don't disconnect - let service handle reconnection
        // chatService.disconnect();
      }
    };
  }, [chatService]); // eslint-disable-line react-hooks/exhaustive-deps

  return {
    messages,
    isConnected,
    isStreaming,
    error,
    sessionId,
    preprocessingStatus,
    preprocessingProgress,
    connect,
    disconnect,
    sendMessage,
    cancelGeneration,
    clearHistory,
    appendEvent,
    switchSession,
    hydrateMessages,
  };
}
