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

  // Ref to track current streaming message
  const currentStreamingMessageRef = useRef<string | null>(null);
  const streamingContentRef = useRef<string>('');

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
    if (currentStreamingMessageRef.current) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === currentStreamingMessageRef.current
            ? { ...msg, isStreaming: false, content: msg.content + ' [cancelled]' }
            : msg
        )
      );
      currentStreamingMessageRef.current = null;
      streamingContentRef.current = '';
    }
    setIsStreaming(false);
  }, [chatService]);

  // Clear message history
  const clearHistory = useCallback(() => {
    setMessages([]);
    setError(null);
    setPreprocessingStatus(null);
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
          streamingContentRef.current += data.content;
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === currentStreamingMessageRef.current
                ? { ...msg, content: streamingContentRef.current }
                : msg
            )
          );
        }
      })
    );

    // Message complete event
    subscriptions.push(
      chatService.subscribe(CHAT_EVENTS.MESSAGE_COMPLETE, () => {
        if (currentStreamingMessageRef.current) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === currentStreamingMessageRef.current
                ? { ...msg, isStreaming: false }
                : msg
            )
          );
          currentStreamingMessageRef.current = null;
          streamingContentRef.current = '';
        }
        setIsStreaming(false);
        setPreprocessingStatus(null);
      })
    );

    // Error event
    subscriptions.push(
      chatService.subscribe(CHAT_EVENTS.ERROR, (data) => {
        setError(data.error || 'Unknown error');
        setIsStreaming(false);
        setPreprocessingStatus(null);

        // Update streaming message with error
        if (currentStreamingMessageRef.current) {
          setMessages((prev) =>
            prev.map((msg) =>
              msg.id === currentStreamingMessageRef.current
                ? {
                    ...msg,
                    isStreaming: false,
                    content: msg.content || `Error: ${data.error}`,
                  }
                : msg
            )
          );
          currentStreamingMessageRef.current = null;
          streamingContentRef.current = '';
        }
      })
    );

    // Preprocessing event
    subscriptions.push(
      chatService.subscribe(CHAT_EVENTS.PREPROCESSING, (data) => {
        setPreprocessingStatus(data.status);
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
    connect,
    disconnect,
    sendMessage,
    cancelGeneration,
    clearHistory,
  };
}
