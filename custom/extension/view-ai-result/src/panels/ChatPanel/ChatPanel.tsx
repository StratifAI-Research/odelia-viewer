import React, { useState, useEffect, useRef, useCallback } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';
import { useSystem } from '@ohif/core';
import {
  Button,
  Icons,
  Input,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useImageViewer,
  useViewportGrid,
} from '@ohif/ui-next';
import { useChatService } from '../../hooks/useChatService';
import { useActiveStudyUID } from '../../hooks/useActiveStudyUID';
import { ChatMessage, ChatSeriesInfo } from '../../types/chatTypes';

// ui-next ships no Textarea, so the two multi-line fields borrow the token set
// its `Input` uses. Kept in one place so they cannot drift apart.
const TEXTAREA_CLASS =
  'border-input text-foreground bg-background placeholder:text-muted-foreground focus-visible:ring-ring w-full rounded border px-3 py-2 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 disabled:cursor-not-allowed disabled:opacity-50';

// Configure marked for synchronous rendering
marked.setOptions({
  breaks: true, // Convert \n to <br> (matches chat UX expectations)
  gfm: true, // GitHub Flavored Markdown (tables, strikethrough, etc.)
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
  // ImageViewerContext is created with `createContext(null)` upstream, so the
  // hook is typed as null; the provider always supplies StudyInstanceUIDs.
  const { StudyInstanceUIDs } = useImageViewer() as unknown as { StudyInstanceUIDs: string[] };
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
      if (!res.ok) {
        throw new Error(`Failed to load: ${res.status}`);
      }
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
      if (!res.ok) {
        throw new Error(`Failed to save: ${res.status}`);
      }
      setIsSettingsOpen(false);
    } catch (e: any) {
      setSettingsError(e.message || 'Failed to save settings');
    } finally {
      setSettingsLoading(false);
    }
  }, [
    systemPrompt,
    ollamaModel,
    numSlices,
    sliceStrategy,
    centralPercentage,
    ollamaThink,
    ollamaSuffix,
  ]);

  // Clear image cache
  const clearCache = useCallback(async () => {
    setSettingsLoading(true);
    try {
      const res = await fetch(`${getChatApiBase()}/debug/cache`, { method: 'DELETE' });
      if (!res.ok) {
        throw new Error(`Failed to clear: ${res.status}`);
      }
      const data = await res.json();
      servicesManager?.services?.uiNotificationService?.show({
        title: 'Chat',
        message: `Cache cleared: ${data.cleared_entries} entries removed`,
        type: 'success',
        duration: 3000,
      });
    } catch (e: any) {
      setSettingsError(e.message || 'Failed to clear cache');
    } finally {
      setSettingsLoading(false);
    }
  }, [servicesManager]);

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
      if (!displaySetService) {
        return;
      }

      const displaySets = displaySetService.getActiveDisplaySets();
      const studyDisplaySets = displaySets.filter(
        (ds: any) =>
          ds.StudyInstanceUID === studyUID && ds.Modality !== 'SR' && ds.Modality !== 'SC'
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
  }, [
    activeViewportId,
    viewports,
    getStudyUIDFromActiveViewport,
    activeStudyUID,
    loadSeriesForStudy,
  ]);

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
    if (!inputValue.trim() || isStreaming) {
      return;
    }

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
    setSelectedSeriesUIDs(prev => {
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
    setSelectedSeriesUIDs(new Set(availableSeries.map(s => s.SeriesInstanceUID)));
  };

  const clearSeriesSelection = () => {
    setSelectedSeriesUIDs(new Set());
  };

  // Render connection status
  const renderConnectionStatus = () => {
    if (!isConnected) {
      return (
        <div className="flex items-center justify-between border-b border-yellow-700 bg-yellow-900/50 px-3 py-2">
          <span className="text-xs text-yellow-300">Disconnected</span>
          <Button
            variant="secondary"
            size="sm"
            onClick={connect}
          >
            Reconnect
          </Button>
        </div>
      );
    }
    return null;
  };

  // Render series context selector
  const renderContextSelector = () => {
    return (
      <div className="border-input border-b">
        <button
          onClick={() => setIsContextExpanded(!isContextExpanded)}
          className="hover:bg-accent flex w-full items-center justify-between px-3 py-2 text-sm"
        >
          <span className="flex items-center gap-2">
            <span className="text-muted-foreground">Context:</span>
            <span className="text-foreground">
              {selectedSeriesUIDs.size > 0
                ? `${selectedSeriesUIDs.size} series selected`
                : 'No series selected'}
            </span>
          </span>
          <span className="text-muted-foreground">{isContextExpanded ? '▲' : '▼'}</span>
        </button>

        {isContextExpanded && (
          <div className="px-3 pb-3">
            {activeStudyUID && (
              <div className="text-muted-foreground mb-2 break-all text-xs">
                Study: {activeStudyUID.slice(0, 30)}...
              </div>
            )}

            {availableSeries.length === 0 ? (
              <div className="text-muted-foreground text-xs">No series available</div>
            ) : (
              <>
                {/* Action buttons */}
                <div className="mb-2 flex gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={selectAllSeries}
                  >
                    Select All
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={clearSeriesSelection}
                  >
                    Clear
                  </Button>
                </div>

                {/* Series list */}
                <div className="max-h-32 space-y-1 overflow-y-auto">
                  {availableSeries.map(series => {
                    const isSelected = selectedSeriesUIDs.has(series.SeriesInstanceUID);
                    return (
                      <div
                        key={series.SeriesInstanceUID}
                        onClick={() => toggleSeries(series.SeriesInstanceUID)}
                        className={`cursor-pointer rounded p-2 text-xs ${isSelected ? 'bg-primary/20 border-primary border' : 'bg-muted hover:bg-accent'} `}
                      >
                        <div className="flex items-center gap-2">
                          <div
                            className={`h-3 w-3 flex-shrink-0 rounded border ${isSelected ? 'bg-primary border-primary' : 'border-input'} `}
                          >
                            {isSelected && (
                              <svg
                                viewBox="0 0 24 24"
                                className="text-primary-foreground h-3 w-3"
                              >
                                <path
                                  fill="currentColor"
                                  d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
                                />
                              </svg>
                            )}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-foreground truncate">
                              {series.SeriesDescription}
                            </div>
                            <div className="text-muted-foreground">
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
          className={`max-w-[85%] rounded-lg px-3 py-2 ${isUser ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground'} `}
        >
          {/* Series context indicator for user messages */}
          {isUser && message.seriesContext && message.seriesContext.length > 0 && (
            <div className="text-highlight mb-1 text-xs">
              + {message.seriesContext.length} series context
            </div>
          )}

          {/* Assistant thinking (collapsible) */}
          {hasThinking && (
            <div className="mb-2 text-xs">
              <button
                type="button"
                onClick={() => toggleThinking(message.id)}
                className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[11px]"
              >
                <span>{isThinkingExpanded ? 'Hide thinking' : 'Show thinking'}</span>
                <span>{isThinkingExpanded ? '▲' : '▼'}</span>
              </button>
              {isThinkingExpanded && (
                <div className="bg-background/60 mt-1 max-h-40 overflow-y-auto rounded px-2 py-1">
                  <div className="break-words text-[11px]">
                    <span
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(message.thinking || '') }}
                    />
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Message content */}
          <div className="break-words text-sm">
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
                <div className="bg-highlight h-1.5 w-1.5 animate-pulse rounded-full" />
                <span className="text-muted-foreground text-xs">
                  {preprocessingStatus || 'Generating...'}
                </span>
              </div>
              {preprocessingStatus && preprocessingProgress != null && (
                <div className="bg-secondary mt-1 h-1.5 w-full overflow-hidden rounded-full">
                  <div
                    className="bg-highlight h-1.5 rounded-full transition-all duration-300"
                    style={{ width: `${Math.round(preprocessingProgress * 100)}%` }}
                  />
                </div>
              )}
            </div>
          )}

          {/* Timestamp */}
          <div className="text-muted-foreground mt-1 text-xs">
            {message.timestamp.toLocaleTimeString()}
          </div>
        </div>
      </div>
    );
  };

  // Render error message
  const renderError = () => {
    if (!error) {
      return null;
    }
    return (
      <div className="mx-3 mb-2 rounded border border-red-700 bg-red-900/50 px-3 py-2 text-xs text-red-300">
        {error}
      </div>
    );
  };

  // Render settings modal
  const renderSettingsModal = () => {
    if (!isSettingsOpen) {
      return null;
    }

    return (
      <div className="bg-background/80 absolute inset-0 z-50 flex items-center justify-center p-4">
        <div className="border-input bg-muted max-h-full w-full max-w-md overflow-y-auto rounded-lg border">
          {/* Header */}
          <div className="border-input flex items-center justify-between border-b px-4 py-3">
            <h3 className="text-foreground text-base font-semibold">Chat Settings</h3>
            <Button
              variant="ghost"
              size="icon"
              onClick={() => setIsSettingsOpen(false)}
              aria-label="Close chat settings"
            >
              <Icons.Close className="h-5 w-5" />
            </Button>
          </div>

          {/* Content */}
          <div className="space-y-4 p-4">
            {settingsError && (
              <div className="rounded border border-red-700 bg-red-900/50 px-3 py-2 text-xs text-red-300">
                {settingsError}
              </div>
            )}

            {/* System Prompt */}
            <div>
              <Label
                htmlFor="chat-system-prompt"
                className="mb-1 block text-xs"
              >
                System Prompt
              </Label>
              <textarea
                id="chat-system-prompt"
                value={systemPrompt}
                onChange={e => setSystemPrompt(e.target.value)}
                rows={4}
                className={`${TEXTAREA_CLASS} resize-none`}
                placeholder="Enter system prompt..."
              />
            </div>

            {/* Model */}
            <div>
              <Label
                htmlFor="chat-model"
                className="mb-1 block text-xs"
              >
                Model
              </Label>
              <Input
                id="chat-model"
                type="text"
                value={ollamaModel}
                onChange={e => setOllamaModel(e.target.value)}
                placeholder="e.g. MedAIBase/MedGemma1.5:4b"
              />
            </div>

            {/* Preprocessing Section */}
            <div className="border-input border-t pt-4">
              <h4 className="text-foreground mb-3 text-xs font-semibold">Preprocessing</h4>

              {/* Num Slices */}
              <div className="mb-3">
                <Label
                  htmlFor="chat-num-slices"
                  className="mb-1 block text-xs"
                >
                  Number of Slices
                </Label>
                <Input
                  id="chat-num-slices"
                  type="number"
                  value={numSlices}
                  onChange={e => setNumSlices(parseInt(e.target.value) || 1)}
                  min={1}
                  max={50}
                />
              </div>

              {/* Slice Strategy */}
              <div className="mb-3">
                <Label className="mb-1 block text-xs">Slice Strategy</Label>
                <Select
                  value={sliceStrategy}
                  onValueChange={setSliceStrategy}
                >
                  <SelectTrigger aria-label="Slice Strategy">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SLICE_STRATEGIES.map(opt => (
                      <SelectItem
                        key={opt.value}
                        value={opt.value}
                      >
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Central Percentage (only for central strategy) */}
              {sliceStrategy === 'central' && (
                <div className="mb-3">
                  <Label
                    htmlFor="chat-central-percentage"
                    className="mb-1 block text-xs"
                  >
                    Central Percentage ({centralPercentage}%)
                  </Label>
                  <input
                    id="chat-central-percentage"
                    type="range"
                    value={centralPercentage}
                    onChange={e => setCentralPercentage(parseInt(e.target.value))}
                    min={10}
                    max={100}
                    className="accent-primary w-full"
                  />
                </div>
              )}
            </div>

            {/* Ollama Options Section */}
            <div className="border-input border-t pt-4">
              <h4 className="text-foreground mb-3 text-xs font-semibold">Ollama Options</h4>

              {/* Think (for thinking models like deepseek-r1) */}
              <div className="mb-3">
                <Label className="mb-1 block text-xs">Think Mode (for thinking models)</Label>
                <Select
                  value={ollamaThink === null ? 'default' : ollamaThink ? 'true' : 'false'}
                  onValueChange={val => setOllamaThink(val === 'default' ? null : val === 'true')}
                >
                  <SelectTrigger aria-label="Think Mode">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="default">Default</SelectItem>
                    <SelectItem value="true">Enabled</SelectItem>
                    <SelectItem value="false">Disabled</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Suffix */}
              <div className="mb-3">
                <Label
                  htmlFor="chat-suffix"
                  className="mb-1 block text-xs"
                >
                  Suffix (text after response)
                </Label>
                <Input
                  id="chat-suffix"
                  type="text"
                  value={ollamaSuffix}
                  onChange={e => setOllamaSuffix(e.target.value)}
                  placeholder="Optional suffix..."
                />
              </div>
            </div>

            {/* Cache Section */}
            <div className="border-input border-t pt-4">
              <h4 className="text-foreground mb-3 text-xs font-semibold">Cache</h4>
              <Button
                variant="secondary"
                onClick={clearCache}
                disabled={settingsLoading}
                className="w-full"
              >
                Clear Image Cache
              </Button>
            </div>
          </div>

          {/* Footer */}
          <div className="border-input flex gap-2 border-t px-4 py-3">
            <Button
              variant="secondary"
              onClick={() => setIsSettingsOpen(false)}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              onClick={saveSettings}
              disabled={settingsLoading}
              className="flex-1"
            >
              {settingsLoading ? 'Saving...' : 'Save'}
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="bg-background text-foreground relative flex h-full min-h-0 flex-col">
      {/* Settings Modal */}
      {renderSettingsModal()}

      <div className="flex h-full min-h-0 flex-col">
        {/* Header with settings button */}
        <div className="border-input flex items-center justify-between border-b px-3 py-2">
          <span className="text-muted-foreground text-xs">
            {isConnected ? `Session: ${sessionId?.slice(0, 8)}...` : 'Disconnected'}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={openSettings}
            title="Settings"
            aria-label="Settings"
          >
            <Icons.GearSettings className="h-5 w-5" />
          </Button>
        </div>

        {/* Connection status */}
        {renderConnectionStatus()}

        {/* Context selector */}
        {renderContextSelector()}

        {/* Scrollable messages + fixed input */}
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Messages area */}
          <div className="flex-1 overflow-y-auto p-3">
            {messages.length === 0 ? (
              <div className="text-muted-foreground flex h-full flex-col items-center justify-center text-sm">
                <div className="mb-2">No messages yet</div>
                <div className="text-center text-xs">
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
          <div className="border-input border-t p-3">
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={e => setInputValue(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={isConnected ? 'Ask about this study...' : 'Connecting...'}
                disabled={!isConnected}
                rows={2}
                className={`${TEXTAREA_CLASS} flex-1 resize-none`}
              />
              <div className="flex flex-col gap-1">
                {isStreaming ? (
                  <Button
                    variant="destructive"
                    onClick={cancelGeneration}
                    title="Cancel"
                  >
                    ■
                  </Button>
                ) : (
                  <Button
                    onClick={handleSend}
                    disabled={!isConnected || !inputValue.trim()}
                    title="Send"
                  >
                    ▶
                  </Button>
                )}
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={clearHistory}
                  disabled={messages.length === 0}
                  title="Clear history"
                >
                  Clear
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
