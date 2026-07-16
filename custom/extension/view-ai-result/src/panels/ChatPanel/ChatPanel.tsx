import React, { useState, useEffect, useRef, useCallback } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useSystem } from '@ohif/core';
import { useImageViewer } from '@ohif/ui';
import { useViewportGrid } from '@ohif/ui-next';
import { useChatService } from '../../hooks/useChatService';
import { useActiveStudyUID } from '../../hooks/useActiveStudyUID';
import { ChatMessage, ChatSeriesInfo } from '../../types/chatTypes';

// Configure marked for synchronous rendering
marked.setOptions({
  breaks: true,   // Convert \n to <br> (matches chat UX expectations)
  gfm: true,      // GitHub Flavored Markdown (tables, strikethrough, etc.)
});

// `marked` does NOT sanitize HTML, so its output must never be injected raw into the
// DOM. Chat content is model-generated and untrusted; sanitize with DOMPurify before
// passing to dangerouslySetInnerHTML to prevent XSS.
const renderMarkdown = (text: string): string =>
  DOMPurify.sanitize(marked.parse(text || '') as string);

// Base URL for the chat-middleware debug/settings endpoints. Defaults to the
// same-origin nginx route (`/chat-api`); override via `window.config.chatApiBase`
// when running the middleware directly. Read per call so a config injected after
// the bundle evaluates is honored.
const getChatApiBase = (): string => {
  try {
    const override = (window as any)?.config?.chatApiBase;
    if (typeof override === 'string' && override.length > 0) {
      return override;
    }
  } catch (_) {
    // ignore config access errors
  }
  return '/chat-api';
};

// Slice strategy options
const SLICE_STRATEGIES = [
  { value: 'central', label: 'Central' },
  { value: 'uniform', label: 'Uniform' },
  { value: 'first_n', label: 'First N' },
  { value: 'last_n', label: 'Last N' },
];

/**
 * ChatPanel - AI Chat panel for discussing studies
 * MVP with basic chat UI and series context selection
 */
const ChatPanel: React.FC = () => {
  const { servicesManager } = useSystem();
  const { StudyInstanceUIDs } = useImageViewer();
  const [{ activeViewportId, viewports }] = useViewportGrid();
  const displaySetService = servicesManager?.services?.displaySetService;

  // Chat service hook
  const {
    messages,
    isConnected,
    isStreaming,
    error,
    sessionId,
    preprocessingStatus,
    preprocessingProgress,
    connect,
    sendMessage,
    cancelGeneration,
    clearHistory,
  } = useChatService();

  // Local state
  const [inputValue, setInputValue] = useState('');
  const [activeStudyUID, setActiveStudyUID] = useState<string | null>(null);
  const [availableSeries, setAvailableSeries] = useState<ChatSeriesInfo[]>([]);
  const [selectedSeriesUIDs, setSelectedSeriesUIDs] = useState<Set<string>>(new Set());
  const [isContextExpanded, setIsContextExpanded] = useState(false);

  // Settings modal state
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [systemPrompt, setSystemPrompt] = useState('');
  const [numSlices, setNumSlices] = useState(5);
  const [sliceStrategy, setSliceStrategy] = useState('central');
  const [centralPercentage, setCentralPercentage] = useState(60);

  // Model state
  const [ollamaModel, setOllamaModel] = useState('');

  // Ollama options state
  const [ollamaThink, setOllamaThink] = useState<boolean | null>(null);
  const [ollamaSuffix, setOllamaSuffix] = useState('');

  // Thinking section expansion state (per-message)
  const [expandedThinkingIds, setExpandedThinkingIds] = useState<Set<string>>(new Set());

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // Load settings from debug API
  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      const res = await fetch(`${getChatApiBase()}/debug/config`);
      if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
      const data = await res.json();
      setSystemPrompt(data.system_prompt || '');
      setOllamaModel(data.model || '');
      setNumSlices(data.preprocessing?.num_slices || 5);
      setSliceStrategy(data.preprocessing?.slice_strategy || 'central');
      setCentralPercentage(data.preprocessing?.central_percentage || 60);
      // Ollama options
      setOllamaThink(data.ollama_options?.think ?? null);
      setOllamaSuffix(data.ollama_options?.suffix || '');
    } catch (e: any) {
      setSettingsError(e.message || 'Failed to load settings');
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  // Save settings to debug API
  const saveSettings = useCallback(async () => {
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      const res = await fetch(`${getChatApiBase()}/debug/config`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_prompt: systemPrompt,
          model: ollamaModel || undefined,
          preprocessing: {
            num_slices: numSlices,
            slice_strategy: sliceStrategy,
            central_percentage: centralPercentage,
          },
          ollama_options: {
            think: ollamaThink,
            suffix: ollamaSuffix || null,
          },
        }),
      });
      if (!res.ok) throw new Error(`Failed to save: ${res.status}`);
      setIsSettingsOpen(false);
    } catch (e: any) {
      setSettingsError(e.message || 'Failed to save settings');
    } finally {
      setSettingsLoading(false);
    }
  }, [systemPrompt, ollamaModel, numSlices, sliceStrategy, centralPercentage, ollamaThink, ollamaSuffix]);

  // Clear image cache
  const clearCache = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const res = await fetch(`${getChatApiBase()}/debug/cache`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Failed to clear: ${res.status}`);
      const data = await res.json();
      alert(`Cache cleared: ${data.cleared_entries} entries removed`);
    } catch (e: any) {
      setSettingsError(e.message || 'Failed to clear cache');
    } finally {
      setSettingsLoading(false);
    }
  }, []);

  // Open settings modal and load current config
  const openSettings = useCallback(() => {
    setIsSettingsOpen(true);
    loadSettings();
  }, [loadSettings]);

  // Get active study UID from viewport
  const getStudyUIDFromActiveViewport = useActiveStudyUID({
    activeViewportId,
    viewports,
    displaySetService,
    StudyInstanceUIDs,
  });

  // Load series for active study
  const loadSeriesForStudy = useCallback(
    (studyUID: string) => {
      if (!displaySetService) return;

      const displaySets = displaySetService.getActiveDisplaySets();
      const studyDisplaySets = displaySets.filter(
        (ds: any) =>
          ds.StudyInstanceUID === studyUID &&
          ds.Modality !== 'SR' &&
          ds.Modality !== 'SC'
      );

      const seriesInfo: ChatSeriesInfo[] = studyDisplaySets.map((ds: any) => ({
        SeriesInstanceUID: ds.SeriesInstanceUID,
        SeriesDescription: ds.SeriesDescription || `Series ${ds.SeriesNumber || 'N/A'}`,
        SeriesNumber: ds.SeriesNumber || 0,
        Modality: ds.Modality || 'Unknown',
        numImageFrames: ds.numImageFrames || ds.instances?.length || 0,
      }));

      // Sort by series number
      seriesInfo.sort((a, b) => a.SeriesNumber - b.SeriesNumber);

      setAvailableSeries(seriesInfo);
    },
    [displaySetService]
  );

  // Track active study
  useEffect(() => {
    const studyUID = getStudyUIDFromActiveViewport();
    if (studyUID && studyUID !== activeStudyUID) {
      setActiveStudyUID(studyUID);
      loadSeriesForStudy(studyUID);
      // Clear selection when study changes
      setSelectedSeriesUIDs(new Set());
    }
  }, [activeViewportId, viewports, getStudyUIDFromActiveViewport, activeStudyUID, loadSeriesForStudy]);

  // Refresh the series context list when display sets arrive/change for the
  // active study (the study-tracking effect above only reloads on study-UID change).
  useEffect(() => {
    if (!activeStudyUID || !displaySetService?.subscribe || !displaySetService?.EVENTS) {
      return;
    }
    const events = [
      displaySetService.EVENTS.DISPLAY_SETS_ADDED,
      displaySetService.EVENTS.DISPLAY_SETS_CHANGED,
    ].filter(Boolean);
    if (events.length === 0) {
      return;
    }
    const subscriptions = events.map(evt =>
      displaySetService.subscribe(evt, () => loadSeriesForStudy(activeStudyUID))
    );
    return () => subscriptions.forEach(sub => sub?.unsubscribe?.());
  }, [displaySetService, activeStudyUID, loadSeriesForStudy]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle send message
  const handleSend = useCallback(() => {
    if (!inputValue.trim() || isStreaming) return;

    const seriesUIDs = selectedSeriesUIDs.size > 0 ? Array.from(selectedSeriesUIDs) : undefined;
    sendMessage(inputValue.trim(), activeStudyUID || undefined, seriesUIDs);
    setInputValue('');
    inputRef.current?.focus();
  }, [inputValue, isStreaming, activeStudyUID, selectedSeriesUIDs, sendMessage]);

  // Handle key press
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Toggle series selection
  const toggleSeries = (seriesUID: string) => {
    setSelectedSeriesUIDs((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(seriesUID)) {
        newSet.delete(seriesUID);
      } else {
        newSet.add(seriesUID);
      }
      return newSet;
    });
  };

  // Select/clear all series
  const selectAllSeries = () => {
    setSelectedSeriesUIDs(new Set(availableSeries.map((s) => s.SeriesInstanceUID)));
  };

  const clearSeriesSelection = () => {
    setSelectedSeriesUIDs(new Set());
  };

  // Render connection status
  const renderConnectionStatus = () => {
    if (!isConnected) {
      return (
        <div className="flex items-center justify-between px-3 py-2 bg-yellow-900/50 border-b border-yellow-700">
          <span className="text-yellow-300 text-xs">Disconnected</span>
          <button
            onClick={connect}
            className="text-xs px-2 py-1 bg-yellow-700 hover:bg-yellow-600 rounded"
          >
            Reconnect
          </button>
        </div>
      );
    }
    return null;
  };

  // Render series context selector
  const renderContextSelector = () => {
    return (
      <div className="border-b border-gray-700">
        <button
          onClick={() => setIsContextExpanded(!isContextExpanded)}
          className="w-full px-3 py-2 flex items-center justify-between text-sm hover:bg-gray-800"
        >
          <span className="flex items-center gap-2">
            <span className="text-gray-400">Context:</span>
            <span className="text-white">
              {selectedSeriesUIDs.size > 0
                ? `${selectedSeriesUIDs.size} series selected`
                : 'No series selected'}
            </span>
          </span>
          <span className="text-gray-500">{isContextExpanded ? '▲' : '▼'}</span>
        </button>

        {isContextExpanded && (
          <div className="px-3 pb-3">
            {activeStudyUID && (
              <div className="text-xs text-gray-500 mb-2 break-all">
                Study: {activeStudyUID.slice(0, 30)}...
              </div>
            )}

            {availableSeries.length === 0 ? (
              <div className="text-xs text-gray-500">No series available</div>
            ) : (
              <>
                {/* Action buttons */}
                <div className="flex gap-2 mb-2">
                  <button
                    onClick={selectAllSeries}
                    className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded"
                  >
                    Select All
                  </button>
                  <button
                    onClick={clearSeriesSelection}
                    className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded"
                  >
                    Clear
                  </button>
                </div>

                {/* Series list */}
                <div className="max-h-32 overflow-y-auto space-y-1">
                  {availableSeries.map((series) => {
                    const isSelected = selectedSeriesUIDs.has(series.SeriesInstanceUID);
                    return (
                      <div
                        key={series.SeriesInstanceUID}
                        onClick={() => toggleSeries(series.SeriesInstanceUID)}
                        className={`
                          p-2 rounded cursor-pointer text-xs
                          ${isSelected ? 'bg-primary-dark border border-primary-light' : 'bg-gray-800 hover:bg-gray-700'}
                        `}
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-3 h-3 rounded border flex-shrink-0
                              ${isSelected ? 'bg-primary-light border-primary-light' : 'border-gray-600'}
                            `}
                          >
                            {isSelected && (
                              <svg viewBox="0 0 24 24" className="w-3 h-3 text-black">
                                <path
                                  fill="currentColor"
                                  d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
                                />
                              </svg>
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="truncate text-white">{series.SeriesDescription}</div>
                            <div className="text-gray-500">
                              {series.Modality} · {series.numImageFrames} frames
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    );
  };

  const toggleThinking = (messageId: string) => {
    setExpandedThinkingIds(prev => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
  };

  // Render a single message
  const renderMessage = (message: ChatMessage) => {
    const isUser = message.role === 'user';
    const isAssistant = message.role === 'assistant';
    const hasThinking = isAssistant && !!message.thinking;
    const isThinkingExpanded = hasThinking && expandedThinkingIds.has(message.id);

    return (
      <div
        key={message.id}
        className={`mb-3 ${isUser ? 'flex justify-end' : ''}`}
      >
        <div
          className={`
            max-w-[85%] rounded-lg px-3 py-2
            ${isUser ? 'bg-primary-dark text-white' : 'bg-gray-800 text-gray-100'}
          `}
        >
          {/* Series context indicator for user messages */}
          {isUser && message.seriesContext && message.seriesContext.length > 0 && (
            <div className="text-xs text-primary-light mb-1">
              + {message.seriesContext.length} series context
            </div>
          )}

          {/* Assistant thinking (collapsible) */}
          {hasThinking && (
            <div className="mb-2 text-xs">
              <button
                type="button"
                onClick={() => toggleThinking(message.id)}
                className="flex items-center gap-1 text-[11px] text-gray-400 hover:text-gray-200"
              >
                <span>{isThinkingExpanded ? 'Hide thinking' : 'Show thinking'}</span>
                <span>{isThinkingExpanded ? '▲' : '▼'}</span>
              </button>
              {isThinkingExpanded && (
                <div className="mt-1 rounded bg-gray-900/60 px-2 py-1 max-h-40 overflow-y-auto">
                  <div className="text-[11px] break-words">
                    <span dangerouslySetInnerHTML={{ __html: renderMarkdown(message.thinking || '') }} />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Message content */}
          <div className="text-sm break-words">
            {isAssistant ? (
              <span
                dangerouslySetInnerHTML={{
                  __html: renderMarkdown(message.content || (message.isStreaming ? '...' : '')),
                }}
              />
            ) : (
              message.content || (message.isStreaming ? '...' : '')
            )}
          </div>

          {/* Streaming indicator */}
          {message.isStreaming && (
            <div className="mt-1">
              <div className="flex items-center gap-1">
                <div className="w-1.5 h-1.5 bg-primary-light rounded-full animate-pulse" />
                <span className="text-xs text-gray-400">
                  {preprocessingStatus || 'Generating...'}
                </span>
              </div>
              {preprocessingStatus && preprocessingProgress != null && (
                <div className="mt-1 w-full bg-gray-700 rounded-full h-1.5 overflow-hidden">
                  <div
                    className="bg-primary-light h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${Math.round(preprocessingProgress * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Timestamp */}
          <div className="text-xs text-gray-500 mt-1">
            {message.timestamp.toLocaleTimeString()}
          </div>
        </div>
      </div>
    );
  };

  // Render error message
  const renderError = () => {
    if (!error) return null;
    return (
      <div className="mx-3 mb-2 px-3 py-2 bg-red-900/50 border border-red-700 rounded text-xs text-red-300">
        {error}
      </div>
    );
  };

  // Render settings modal
  const renderSettingsModal = () => {
    if (!isSettingsOpen) return null;

    return (
      <div className="absolute inset-0 bg-black/80 z-50 flex items-center justify-center p-4">
        <div className="bg-gray-900 rounded-lg w-full max-w-md max-h-full overflow-y-auto border border-gray-700">
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-700">
            <h3 className="text-sm font-semibold">Chat Settings</h3>
            <button
              onClick={() => setIsSettingsOpen(false)}
              className="text-gray-400 hover:text-white"
            >
              ✕
            </button>
          </div>

          {/* Content */}
          <div className="p-4 space-y-4">
            {settingsError && (
              <div className="px-3 py-2 bg-red-900/50 border border-red-700 rounded text-xs text-red-300">
                {settingsError}
              </div>
            )}

            {/* System Prompt */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">System Prompt</label>
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                rows={4}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm resize-none
                  focus:outline-none focus:border-primary-light"
                placeholder="Enter system prompt..."
              />
            </div>

            {/* Model */}
            <div>
              <label className="block text-xs text-gray-400 mb-1">Model</label>
              <input
                type="text"
                value={ollamaModel}
                onChange={(e) => setOllamaModel(e.target.value)}
                className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm
                  focus:outline-none focus:border-primary-light"
                placeholder="e.g. MedAIBase/MedGemma1.5:4b"
              />
            </div>

            {/* Preprocessing Section */}
            <div className="border-t border-gray-700 pt-4">
              <h4 className="text-xs font-semibold text-gray-300 mb-3">Preprocessing</h4>

              {/* Num Slices */}
              <div className="mb-3">
                <label className="block text-xs text-gray-400 mb-1">Number of Slices</label>
                <input
                  type="number"
                  value={numSlices}
                  onChange={(e) => setNumSlices(parseInt(e.target.value) || 1)}
                  min={1}
                  max={50}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm
                    focus:outline-none focus:border-primary-light"
                />
              </div>

              {/* Slice Strategy */}
              <div className="mb-3">
                <label className="block text-xs text-gray-400 mb-1">Slice Strategy</label>
                <select
                  value={sliceStrategy}
                  onChange={(e) => setSliceStrategy(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm
                    focus:outline-none focus:border-primary-light"
                >
                  {SLICE_STRATEGIES.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Central Percentage (only for central strategy) */}
              {sliceStrategy === 'central' && (
                <div className="mb-3">
                  <label className="block text-xs text-gray-400 mb-1">
                    Central Percentage ({centralPercentage}%)
                  </label>
                  <input
                    type="range"
                    value={centralPercentage}
                    onChange={(e) => setCentralPercentage(parseInt(e.target.value))}
                    min={10}
                    max={100}
                    className="w-full"
                  />
                </div>
              )}
            </div>

            {/* Ollama Options Section */}
            <div className="border-t border-gray-700 pt-4">
              <h4 className="text-xs font-semibold text-gray-300 mb-3">Ollama Options</h4>

              {/* Think (for thinking models like deepseek-r1) */}
              <div className="mb-3">
                <label className="block text-xs text-gray-400 mb-1">Think Mode (for thinking models)</label>
                <select
                  value={ollamaThink === null ? 'default' : ollamaThink ? 'true' : 'false'}
                  onChange={(e) => {
                    const val = e.target.value;
                    setOllamaThink(val === 'default' ? null : val === 'true');
                  }}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm
                    focus:outline-none focus:border-primary-light"
                >
                  <option value="default">Default</option>
                  <option value="true">Enabled</option>
                  <option value="false">Disabled</option>
                </select>
              </div>

              {/* Suffix */}
              <div className="mb-3">
                <label className="block text-xs text-gray-400 mb-1">Suffix (text after response)</label>
                <input
                  type="text"
                  value={ollamaSuffix}
                  onChange={(e) => setOllamaSuffix(e.target.value)}
                  className="w-full bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm
                    focus:outline-none focus:border-primary-light"
                  placeholder="Optional suffix..."
                />
              </div>
            </div>

            {/* Cache Section */}
            <div className="border-t border-gray-700 pt-4">
              <h4 className="text-xs font-semibold text-gray-300 mb-3">Cache</h4>
              <button
                onClick={clearCache}
                disabled={settingsLoading}
                className="w-full px-3 py-2 bg-yellow-700 hover:bg-yellow-600 rounded text-sm
                  disabled:opacity-50"
              >
                Clear Image Cache
              </button>
            </div>
          </div>

          {/* Footer */}
          <div className="flex gap-2 px-4 py-3 border-t border-gray-700">
            <button
              onClick={() => setIsSettingsOpen(false)}
              className="flex-1 px-3 py-2 bg-gray-700 hover:bg-gray-600 rounded text-sm"
            >
              Cancel
            </button>
            <button
              onClick={saveSettings}
              disabled={settingsLoading}
              className="flex-1 px-3 py-2 bg-primary-main hover:bg-primary-light rounded text-sm
                disabled:opacity-50"
            >
              {settingsLoading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full min-h-0 bg-black text-white relative">
      {/* Settings Modal */}
      {renderSettingsModal()}

      <div className="flex flex-col h-full min-h-0">
        {/* Header with settings button */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-gray-700">
          <span className="text-xs text-gray-400">
            {isConnected ? `Session: ${sessionId?.slice(0, 8)}...` : 'Disconnected'}
          </span>
          <button
            onClick={openSettings}
            className="p-1.5 hover:bg-gray-700 rounded text-gray-400 hover:text-white"
            title="Settings"
          >
            {/* Wrench icon */}
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="w-4 h-4"
            >
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
          </button>
        </div>

        {/* Connection status */}
        {renderConnectionStatus()}

        {/* Context selector */}
        {renderContextSelector()}

        {/* Scrollable messages + fixed input */}
        <div className="flex flex-col flex-1 min-h-0">
          {/* Messages area */}
          <div className="flex-1 overflow-y-auto p-3">
            {messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-gray-500 text-sm">
                <div className="mb-2">No messages yet</div>
                <div className="text-xs text-center">
                  Select series above for context, then ask questions about your study.
                </div>
              </div>
            ) : (
              <>
                {messages.map(renderMessage)}
                <div ref={messagesEndRef} />
              </>
            )}
          </div>

          {/* Error display */}
          {renderError()}

          {/* Input area */}
          <div className="border-t border-gray-700 p-3">
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isConnected ? 'Ask about this study...' : 'Connecting...'}
                disabled={!isConnected}
                rows={2}
                className="flex-1 bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm resize-none
              focus:outline-none focus:border-primary-light disabled:opacity-50"
              />
              <div className="flex flex-col gap-1">
                {isStreaming ? (
                  <button
                    onClick={cancelGeneration}
                    className="px-3 py-2 bg-red-700 hover:bg-red-600 rounded text-sm"
                    title="Cancel"
                  >
                    ■
                  </button>
                ) : (
                  <button
                    onClick={handleSend}
                    disabled={!isConnected || !inputValue.trim()}
                    className="px-3 py-2 bg-primary-main hover:bg-primary-light rounded text-sm
                  disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Send"
                  >
                    ▶
                  </button>
                )}
                <button
                  onClick={clearHistory}
                  disabled={messages.length === 0}
                  className="px-3 py-1 bg-gray-700 hover:bg-gray-600 rounded text-xs
                disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Clear history"
                >
                  Clear
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
