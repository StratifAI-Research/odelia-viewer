/**
 * useChatService - React hook for interacting with ChatService
 * Manages chat state, message history, and streaming
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { useSystem } from '@ohif/core';
import { ChatMessage, CHAT_EVENTS, ChatSession } from '../types/chatTypes';
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
  sendMessage: (content: string, studyUID?: string, seriesUIDs?: string[]) => void;
  cancelGeneration: () => void;
  clearHistory: () => void;
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
    if (!chatService) return;
    chatService.disconnect();
    setIsConnected(false);
    setSessionId(null);
  }, [chatService]);

  // Send a message
  const sendMessage = useCallback(
    (content: string, studyUID?: string, seriesUIDs?: string[]) => {
      if (!chatService || !content.trim()) return;

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
      };
      setMessages((prev) => [...prev, userMessage]);

      // Create placeholder for assistant response
      const assistantMessageId = generateMessageId();
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: 'assistant',
        content: '',
        timestamp: new Date(),
        isStreaming: true,
      };
      setMessages((prev) => [...prev, assistantMessage]);

      // Track streaming state
      currentStreamingMessageRef.current = assistantMessageId;
      streamingContentRef.current = '';
      streamingThinkingRef.current = '';
      rawStreamingRef.current = '';
      setIsStreaming(true);

      // Send to service
      chatService.sendMessage(content.trim(), studyUID, seriesUIDs);
    },
    [chatService]
  );

  // Cancel current generation
  const cancelGeneration = useCallback(() => {
    if (!chatService) return;
    chatService.cancelGeneration();

    // Mark current message as complete
    const messageId = currentStreamingMessageRef.current;
    if (messageId) {
      currentStreamingMessageRef.current = null;
      streamingContentRef.current = '';
      streamingThinkingRef.current = '';
      rawStreamingRef.current = '';
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === messageId
            ? { ...msg, isStreaming: false, content: msg.content + ' [cancelled]' }
            : msg
        )
      );
    }
    setIsStreaming(false);
  }, [chatService]);

  // Clear message history
  const clearHistory = useCallback(() => {
    setMessages([]);
    setError(null);
    setPreprocessingStatus(null);
    setPreprocessingProgress(null);
    currentStreamingMessageRef.current = null;
    streamingContentRef.current = '';
    streamingThinkingRef.current = '';
    rawStreamingRef.current = '';
  }, []);

  // Subscribe to service events
  useEffect(() => {
    if (!chatService) return;

    const subscriptions: Array<{ unsubscribe: () => void }> = [];

    // Connected event
    subscriptions.push(
      chatService.subscribe(CHAT_EVENTS.CONNECTED, (data) => {
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
        setIsStreaming(false);
      })
    );

    // Token event - append to current streaming message
    subscriptions.push(
      chatService.subscribe(CHAT_EVENTS.TOKEN, (data) => {
        if (currentStreamingMessageRef.current && data.content) {
          // Clear preprocessing status on first token (transition to generating)
          if (rawStreamingRef.current.length === 0) {
            setPreprocessingStatus(null);
            setPreprocessingProgress(null);
          }
          rawStreamingRef.current += data.content;
          const { visibleText, thinkingText } = splitThinkingFromContent(rawStreamingRef.current);
          streamingContentRef.current = visibleText;
          streamingThinkingRef.current = thinkingText;
          setMessages((prev) =>
            prev.map((msg) =>
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

    // Message complete event
    subscriptions.push(
      chatService.subscribe(CHAT_EVENTS.MESSAGE_COMPLETE, () => {
        const messageId = currentStreamingMessageRef.current;
        if (messageId) {
          currentStreamingMessageRef.current = null;
          streamingContentRef.current = '';
          streamingThinkingRef.current = '';
          rawStreamingRef.current = '';
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === messageId
                ? { ...msg, isStreaming: false }
                : msg
            )
          );
        }
        setIsStreaming(false);
        setPreprocessingStatus(null);
        setPreprocessingProgress(null);
      })
    );

    // Error event
    subscriptions.push(
      chatService.subscribe(CHAT_EVENTS.ERROR, (data) => {
        setError(data.error || 'Unknown error');
        setIsStreaming(false);
        setPreprocessingStatus(null);
        setPreprocessingProgress(null);

        // Update streaming message with error
        const messageId = currentStreamingMessageRef.current;
        if (messageId) {
          currentStreamingMessageRef.current = null;
          streamingContentRef.current = '';
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === messageId
                ? {
                    ...msg,
                    isStreaming: false,
                    content: msg.content || `Error: ${data.error}`,
                  }
                : msg
            )
          );
        }
      })
    );

    // Preprocessing event
    subscriptions.push(
      chatService.subscribe(CHAT_EVENTS.PREPROCESSING, (data) => {
        setPreprocessingStatus(data.status);
        setPreprocessingProgress(data.progress ?? null);
      })
    );

    // Cleanup subscriptions
    return () => {
      subscriptions.forEach((sub) => sub.unsubscribe());
    };
  }, [chatService]);

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
  };
}
