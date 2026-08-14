import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
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
import { useViewerSlice } from '../../hooks/useViewerSlice';
import {
  ChatMessage,
  ChatSeriesInfo,
  ProviderName,
  SnapshotSeries,
  WireSliceSelection,
} from '../../types/chatTypes';
import { shortModelLabel } from '../../utils/modelLabel';
import { resolveStudyTags } from '../../utils/studyTags';
import {
  ChatThread,
  deriveThreadTitle,
  formatRelativeTime,
  loadThreads,
  newThreadId,
  removeThread,
  saveThreads,
  upsertThread,
} from '../../utils/chatThreads';
import ChatHistoryIcon from '../../icons/ChatHistoryIcon';
import {
  buildPromptContextSnapshot,
  formatSeriesSliceSource,
  formatSliceList,
  formatSliceRecipe,
  formatSnapshotSummary,
  formatStudyLabel,
  StudyLabelSource,
} from '../../utils/promptContext';
import {
  canAddressSlices,
  clampRange,
  initialRange,
  MAX_SLICES_PER_SERIES,
  rangeSize,
  sampleSliceNumbers,
  SliceRange,
} from '../../utils/sliceSelection';
import SliceRangeSlider from './SliceRangeSlider';

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

/** A model offered by the cloud backend, as reported by the middleware. */
interface CloudModelInfo {
  name: string;
  capabilities: string[];
  supports_vision: boolean;
}

/**
 * Whether the prompt context tracks the viewport or is held fixed.
 *
 * `following` lets an untouched, empty prompt adopt whatever the viewer shows.
 * `pinned` freezes it. The panel pins automatically as soon as the user invests
 * anything in the prompt (types, or attaches a series), because from that moment
 * a silent context change would rewrite the question they are composing.
 */
type ContextMode = 'following' | 'pinned';

/** Dismiss a popover on outside click or Escape. */
function useDismissOnOutside(
  ref: React.RefObject<HTMLElement>,
  isOpen: boolean,
  onDismiss: () => void
): void {
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onPointerDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onDismiss();
      }
    };
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [ref, isOpen, onDismiss]);
}

/**
 * ChatPanel - AI Chat panel for discussing studies
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
    appendEvent,
    switchSession,
    hydrateMessages,
  } = useChatService();

  // Composer
  const [inputValue, setInputValue] = useState('');

  // --- Chat threads ---------------------------------------------------------
  // The browser owns the displayed transcript (it carries per-message
  // provenance the middleware does not store); the middleware owns what the
  // model remembers, keyed by session id. `serverSessionId` joins the two.
  const [threads, setThreads] = useState<ChatThread[]>(() => loadThreads());
  const [activeThreadId, setActiveThreadId] = useState<string>(() => newThreadId());
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  // session id -> number of turns the middleware still holds. Undefined until
  // looked up; a session absent from the map has been dropped (the store is
  // in-memory, so a middleware restart clears every session).
  const [liveSessions, setLiveSessions] = useState<Record<string, number> | null>(null);

  // --- Prompt context -------------------------------------------------------
  // `viewerStudyUID` is what the main viewport shows; `promptStudyUID` is what
  // the next message will actually be sent with. They are deliberately separate
  // so the two can diverge and the user can be told about it.
  const [viewerStudyUID, setViewerStudyUID] = useState<string | null>(null);
  const [promptStudyUID, setPromptStudyUID] = useState<string | null>(null);
  const [promptStudyInfo, setPromptStudyInfo] = useState<StudyLabelSource | null>(null);
  const [availableSeries, setAvailableSeries] = useState<ChatSeriesInfo[]>([]);
  const [selectedSeriesUIDs, setSelectedSeriesUIDs] = useState<Set<string>>(new Set());
  const [contextMode, setContextMode] = useState<ContextMode>('following');
  const [isSeriesPickerOpen, setIsSeriesPickerOpen] = useState(false);
  // Per-series slice selection, keyed by SeriesInstanceUID. Per-series rather
  // than one global range because attached series differ in depth: "18-62" means
  // nothing shared between a 103-slice and a 24-slice acquisition.
  const [sliceStateBySeries, setSliceStateBySeries] = useState<
    Record<string, { range: SliceRange; count: number }>
  >({});

  // Header menus
  const [isModelMenuOpen, setIsModelMenuOpen] = useState(false);
  const [isOverflowMenuOpen, setIsOverflowMenuOpen] = useState(false);
  const [modelError, setModelError] = useState<string | null>(null);

  // Per-message snapshot expansion
  const [expandedSnapshotIds, setExpandedSnapshotIds] = useState<Set<string>>(new Set());

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

  // Backend provider state.
  //
  // `cloudEnabled` mirrors the operator gate (ALLOW_CLOUD_BACKEND) and
  // `cloudConfigured` reports whether the middleware holds an API key. The key
  // itself is never sent to the browser — it lives only on the middleware — so
  // there is deliberately no key field here.
  const [provider, setProvider] = useState<ProviderName>('local');
  const [cloudEnabled, setCloudEnabled] = useState(false);
  const [cloudConfigured, setCloudConfigured] = useState(false);
  const [cloudUrl, setCloudUrl] = useState('');
  const [cloudModel, setCloudModel] = useState('');
  const [cloudModels, setCloudModels] = useState<CloudModelInfo[]>([]);
  const [cloudModelsLoading, setCloudModelsLoading] = useState(false);
  const [cloudModelsError, setCloudModelsError] = useState<string | null>(null);
  const [cloudCapabilitiesKnown, setCloudCapabilitiesKnown] = useState(true);
  // Text-only models are hidden by default: this chat sends DICOM slices as
  // images, so a model without vision cannot see the study at all, and most of
  // the cloud catalogue is text-only. Kept behind a toggle rather than dropped
  // outright, because a text-only model is still a legitimate choice for asking
  // about conversation history alone, and because capability data can be absent.
  const [showTextOnlyModels, setShowTextOnlyModels] = useState(false);

  // Ollama options state
  const [ollamaThink, setOllamaThink] = useState<boolean | null>(null);
  const [ollamaSuffix, setOllamaSuffix] = useState('');

  // Thinking section expansion state (per-message)
  const [expandedThinkingIds, setExpandedThinkingIds] = useState<Set<string>>(new Set());

  // Refs
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const overflowMenuRef = useRef<HTMLDivElement>(null);
  const seriesPickerRef = useRef<HTMLDivElement>(null);
  const historyMenuRef = useRef<HTMLDivElement>(null);

  useDismissOnOutside(modelMenuRef, isModelMenuOpen, () => setIsModelMenuOpen(false));
  useDismissOnOutside(overflowMenuRef, isOverflowMenuOpen, () => setIsOverflowMenuOpen(false));
  useDismissOnOutside(seriesPickerRef, isSeriesPickerOpen, () => setIsSeriesPickerOpen(false));
  useDismissOnOutside(historyMenuRef, isHistoryOpen, () => setIsHistoryOpen(false));

  // The model tag currently in force, and its short header label.
  const activeModelTag = provider === 'cloud' ? cloudModel : ollamaModel;
  const activeModelLabel = shortModelLabel(activeModelTag);

  // Apply the debug-config payload to local state. Shared by the mount load and
  // the settings modal so the two cannot drift.
  const applyConfigPayload = useCallback((data: any) => {
    setSystemPrompt(data.system_prompt || '');
    setOllamaModel(data.model || '');
    setNumSlices(data.preprocessing?.num_slices || 5);
    setSliceStrategy(data.preprocessing?.slice_strategy || 'central');
    setCentralPercentage(data.preprocessing?.central_percentage || 60);
    // Ollama options
    setOllamaThink(data.ollama_options?.think ?? null);
    setOllamaSuffix(data.ollama_options?.suffix || '');
    // Backend provider. Fields are absent on a middleware predating the cloud
    // backend, so every one falls back to "local / unavailable".
    setProvider(data.provider === 'cloud' ? 'cloud' : 'local');
    setCloudEnabled(Boolean(data.cloud_enabled));
    setCloudConfigured(Boolean(data.cloud_configured));
    setCloudUrl(data.cloud_url || '');
    setCloudModel(data.cloud_model || '');
  }, []);

  // Load settings from debug API
  const loadSettings = useCallback(async () => {
    setSettingsLoading(true);
    setSettingsError(null);
    try {
      const res = await fetch(`${getChatApiBase()}/debug/config`);
      if (!res.ok) {
        throw new Error(`Failed to load: ${res.status}`);
      }
      applyConfigPayload(await res.json());
    } catch (e: any) {
      setSettingsError(e.message || 'Failed to load settings');
    } finally {
      setSettingsLoading(false);
    }
  }, [applyConfigPayload]);

  // The header shows the active model at all times, so the config has to be read
  // on mount rather than only when the settings modal opens.
  useEffect(() => {
    loadSettings();
  }, [loadSettings]);

  // Fetch the cloud model list. The middleware queries the cloud host with its
  // own key, so the key never reaches the browser.
  const loadCloudModels = useCallback(async () => {
    setCloudModelsLoading(true);
    setCloudModelsError(null);
    try {
      const res = await fetch(`${getChatApiBase()}/debug/cloud/models`);
      if (!res.ok) {
        // The middleware returns a specific reason (gate off, key rejected);
        // surfacing it beats a generic failure the user cannot act on.
        let detail = `Failed to list models: ${res.status}`;
        try {
          const body = await res.json();
          if (body?.detail) {
            detail = body.detail;
          }
        } catch (_) {
          // response had no JSON body; keep the status-based message
        }
        throw new Error(detail);
      }
      const data = await res.json();
      setCloudModels(Array.isArray(data.models) ? data.models : []);
      setCloudCapabilitiesKnown(data.capabilities_reported !== false);
    } catch (e: any) {
      setCloudModels([]);
      setCloudModelsError(e.message || 'Failed to list models');
    } finally {
      setCloudModelsLoading(false);
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
          provider,
          cloud_model: cloudModel || undefined,
        }),
      });
      if (!res.ok) {
        // The middleware rejects an unusable cloud selection with a specific
        // reason (gate off, no key, no model chosen) — show it rather than a bare
        // status, since each has a different fix.
        let detail = `Failed to save: ${res.status}`;
        try {
          const body = await res.json();
          if (body?.detail) {
            detail = body.detail;
          }
        } catch (_) {
          // response had no JSON body; keep the status-based message
        }
        throw new Error(detail);
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
    provider,
    cloudModel,
  ]);

  /**
   * Switch model from the header. Writes straight through to the middleware —
   * there is no Save step here — and records the change in the transcript so a
   * later reader can tell which model produced which answer.
   *
   * `preprocessing` is deliberately omitted from the payload: sending it would
   * trip the middleware's auto-clear of the image cache, forcing every attached
   * series to be re-fetched and re-preprocessed just because a model changed.
   */
  const applyModelSelection = useCallback(
    async (nextProvider: ProviderName, nextModel: string) => {
      if (nextProvider === provider && nextModel === activeModelTag) {
        setIsModelMenuOpen(false);
        return;
      }
      setModelError(null);
      try {
        const res = await fetch(`${getChatApiBase()}/debug/config`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(
            nextProvider === 'cloud'
              ? { provider: 'cloud', cloud_model: nextModel }
              : { provider: 'local', model: nextModel }
          ),
        });
        if (!res.ok) {
          let detail = `Failed to switch model: ${res.status}`;
          try {
            const body = await res.json();
            if (body?.detail) {
              detail = body.detail;
            }
          } catch (_) {
            // response had no JSON body; keep the status-based message
          }
          throw new Error(detail);
        }
        setProvider(nextProvider);
        if (nextProvider === 'cloud') {
          setCloudModel(nextModel);
        } else {
          setOllamaModel(nextModel);
        }
        setIsModelMenuOpen(false);
        // Only annotate an in-progress conversation: on an empty transcript the
        // header already states the model, so an event would be noise.
        if (messages.length > 0) {
          appendEvent(`Model changed to ${shortModelLabel(nextModel) || nextModel}`);
        }
      } catch (e: any) {
        setModelError(e.message || 'Failed to switch model');
      }
    },
    [provider, activeModelTag, messages.length, appendEvent]
  );

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

  // Open settings modal and refresh current config
  const openSettings = useCallback(() => {
    setIsOverflowMenuOpen(false);
    setIsSettingsOpen(true);
    loadSettings();
  }, [loadSettings]);

  // Capability record for the selected cloud model, when the list is available.
  // Undefined for a free-text entry, which is why the "no vision" warning below
  // is only shown for a model we actually have capability data for.
  const selectedCloudModelInfo = cloudModels.find(m => m.name === cloudModel);

  // Vision-capable models first and, by default, only those.
  //
  // Filtering is skipped when the host reported no capabilities at all, since
  // every model would then look text-only and the list would come up empty.
  // The currently-selected model is always kept visible so the dropdown can
  // still display what is actually in effect.
  const visionOnlyPossible = cloudCapabilitiesKnown;
  const visibleCloudModels =
    showTextOnlyModels || !visionOnlyPossible
      ? cloudModels
      : cloudModels.filter(m => m.supports_vision || m.name === cloudModel);
  // Counted from the full catalogue, not from what is hidden right now, so the
  // toggle's label does not change as it is ticked.
  const textOnlyCount = cloudModels.filter(m => !m.supports_vision).length;

  const cloudUsable = cloudEnabled && cloudConfigured;

  // Populate the cloud model list when the cloud backend is reachable and a
  // surface that lists models is open. Not fetched on mount: it costs an
  // /api/tags plus one /api/show per model upstream, which is wasted on the far
  // more common local-only deployment. `cloudModelsError` is in the guard so a
  // failed fetch does not retry forever; Refresh is the way back.
  useEffect(() => {
    const wantsList = isModelMenuOpen || (isSettingsOpen && provider === 'cloud');
    if (
      wantsList &&
      cloudUsable &&
      cloudModels.length === 0 &&
      !cloudModelsLoading &&
      !cloudModelsError
    ) {
      loadCloudModels();
    }
  }, [
    isModelMenuOpen,
    isSettingsOpen,
    provider,
    cloudUsable,
    cloudModels.length,
    cloudModelsLoading,
    cloudModelsError,
    loadCloudModels,
  ]);

  // Get active study UID from viewport
  const getStudyUIDFromActiveViewport = useActiveStudyUID({
    activeViewportId,
    viewports,
    displaySetService,
    StudyInstanceUIDs,
  });

  /** Study-level metadata plus selectable series, read from the display sets. */
  const collectStudy = useCallback(
    (studyUID: string): { info: StudyLabelSource; series: ChatSeriesInfo[] } => {
      const info: StudyLabelSource = { StudyInstanceUID: studyUID };
      if (!displaySetService) {
        return { info, series: [] };
      }

      const displaySets = displaySetService.getActiveDisplaySets() || [];
      // `any[]`: OHIF's DisplaySet type omits the study-level tags (StudyDate,
      // StudyDescription) that are present on the runtime objects.
      const studyDisplaySets: any[] = displaySets.filter(
        (ds: any) =>
          ds.StudyInstanceUID === studyUID && ds.Modality !== 'SR' && ds.Modality !== 'SC'
      );

      const tags = resolveStudyTags(studyUID, studyDisplaySets);
      info.StudyDate = tags.StudyDate;
      info.StudyDescription = tags.StudyDescription;

      const series: ChatSeriesInfo[] = studyDisplaySets.map((ds: any) => {
        const instances: any[] = ds.images || ds.instances || [];
        return {
          SeriesInstanceUID: ds.SeriesInstanceUID,
          SeriesDescription: ds.SeriesDescription || `Series ${ds.SeriesNumber || 'N/A'}`,
          SeriesNumber: ds.SeriesNumber || 0,
          Modality: ds.Modality || 'Unknown',
          numImageFrames: ds.numImageFrames || instances.length || 0,
          // Order matters: it is the order the viewer sorted the series into, and
          // therefore the order the slice numbers on screen refer to. Any instance
          // missing its UID drops the whole list, because a partial mapping would
          // silently shift every slice number after the gap.
          sopInstanceUIDs: instances.every((i: any) => i?.SOPInstanceUID)
            ? instances.map((i: any) => i.SOPInstanceUID as string)
            : [],
        };
      });
      series.sort((a, b) => a.SeriesNumber - b.SeriesNumber);

      return { info, series };
    },
    [displaySetService]
  );

  /** Refresh the series list + study metadata for whatever the prompt targets. */
  const reloadPromptStudy = useCallback(
    (studyUID: string) => {
      const { info, series } = collectStudy(studyUID);
      setPromptStudyInfo(info);
      setAvailableSeries(series);
    },
    [collectStudy]
  );

  // Sync from the viewport grid, which is an external system with no subscription
  // API here — hence reading it in an effect.
  //
  // Tracking the viewer and adopting its study are done in ONE effect on purpose:
  // splitting them would publish `viewerStudyUID` in an intermediate render where
  // the prompt has not caught up yet, so the divergence banner would flash for a
  // frame on every ordinary study change while following.
  //
  // `contextMode` is a dependency so that un-pinning re-runs this and adopts
  // whatever the viewer has since moved to.
  useEffect(() => {
    const studyUID = getStudyUIDFromActiveViewport();
    if (!studyUID) {
      return;
    }
    if (studyUID !== viewerStudyUID) {
      setViewerStudyUID(studyUID);
    }
    // Once pinned, a viewport change leaves the prompt alone and surfaces the
    // divergence banner instead of silently retargeting the question.
    if (contextMode === 'following' && studyUID !== promptStudyUID) {
      setPromptStudyUID(studyUID);
      setSelectedSeriesUIDs(new Set());
      setSliceStateBySeries({});
      reloadPromptStudy(studyUID);
    }
  }, [
    activeViewportId,
    viewports,
    getStudyUIDFromActiveViewport,
    viewerStudyUID,
    contextMode,
    promptStudyUID,
    reloadPromptStudy,
  ]);

  // Refresh the prompt's series when display sets arrive/change (the effect above
  // only fires on a study-UID change, and series hydrate asynchronously).
  useEffect(() => {
    if (!promptStudyUID || !displaySetService?.subscribe || !displaySetService?.EVENTS) {
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
      displaySetService.subscribe(evt, () => reloadPromptStudy(promptStudyUID))
    );
    return () => subscriptions.forEach(sub => sub?.unsubscribe?.());
  }, [displaySetService, promptStudyUID, reloadPromptStudy]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // --- Chat threads ---------------------------------------------------------

  /**
   * Persist the active conversation as messages arrive.
   *
   * Only once it has content: an untouched panel would otherwise litter the
   * history with empty "New chat" entries every time it mounts. Streaming
   * messages are written too, so a reload mid-answer keeps the partial turn
   * rather than losing the question with it.
   */
  useEffect(() => {
    if (messages.length === 0) {
      return;
    }
    setThreads(prev => {
      const existing = prev.find(t => t.id === activeThreadId);
      const next: ChatThread = {
        id: activeThreadId,
        title: deriveThreadTitle(messages),
        createdAt: existing?.createdAt ?? Date.now(),
        updatedAt: Date.now(),
        // Keep the last known session if the socket is momentarily down, so a
        // reconnect blip does not orphan the thread from the model's memory.
        serverSessionId: sessionId ?? existing?.serverSessionId ?? null,
        messages,
      };
      return saveThreads(upsertThread(prev, next));
    });
  }, [messages, sessionId, activeThreadId]);

  /** Ask the middleware which sessions it still holds, and how many turns. */
  const refreshLiveSessions = useCallback(async () => {
    try {
      const res = await fetch(`${getChatApiBase()}/debug/sessions`);
      if (!res.ok) {
        throw new Error(String(res.status));
      }
      const data = await res.json();
      const counts: Record<string, number> = {};
      (Array.isArray(data.sessions) ? data.sessions : []).forEach((s: any) => {
        if (s?.session_id) {
          counts[s.session_id] = Number(s.message_count) || 0;
        }
      });
      setLiveSessions(counts);
    } catch (_) {
      // Unknown is not the same as "forgotten" — leaving this null keeps the
      // panel from claiming the model lost a conversation it may still have.
      setLiveSessions(null);
    }
  }, []);

  const openHistory = useCallback(() => {
    // The fetch is kept OUT of the state updater: updaters must be pure, and
    // React may invoke one more than once per commit.
    const willOpen = !isHistoryOpen;
    setIsHistoryOpen(willOpen);
    if (willOpen) {
      refreshLiveSessions();
    }
  }, [isHistoryOpen, refreshLiveSessions]);

  /**
   * Whether the middleware has lost the history behind a thread.
   *
   * Sessions live in memory on the middleware, so a restart drops them all.
   * Reconnecting to a dropped id does not fail — `get_or_create_session` simply
   * makes a fresh, empty one — so an *empty* server session under a non-empty
   * transcript is exactly the signal that the model can no longer see the
   * earlier turns. Returns false while the lookup is unknown.
   */
  const isForgottenByServer = useCallback(
    (thread: ChatThread | undefined): boolean => {
      if (!thread || !liveSessions) {
        return false;
      }
      const hasExchange = thread.messages.some(m => m.role === 'user');
      if (!hasExchange) {
        return false;
      }
      // The middleware commits a turn to its history only once generation has
      // finished, so mid-stream its session legitimately reads as empty.
      // Warning then would flash "the assistant has forgotten this" over an
      // answer that is in the middle of being written.
      if (isStreaming && thread.id === activeThreadId) {
        return false;
      }
      // For the thread that is currently open, the live socket's session is
      // authoritative: the persisted id trails it by a render while a session is
      // being established, and reading the stale value raised a false "the model
      // has forgotten this" on a conversation that had just been answered.
      const effectiveId =
        thread.id === activeThreadId
          ? (sessionId ?? thread.serverSessionId)
          : thread.serverSessionId;
      if (!effectiveId) {
        return true;
      }
      // Present but empty still counts as forgotten: rejoining a dropped id does
      // not fail, the middleware simply creates a fresh, empty session under it.
      return !liveSessions[effectiveId];
    },
    [liveSessions, activeThreadId, sessionId, isStreaming]
  );

  // Re-check once a generation finishes: the snapshot taken before or during it
  // predates the middleware committing the turn, so leaving it in place would
  // keep reporting a session as empty after it stopped being so. Only refreshes
  // if the panel has looked at all — no request on a deployment where the user
  // never opens the history.
  const wasStreamingRef = useRef(false);
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming && liveSessions !== null) {
      refreshLiveSessions();
    }
    wasStreamingRef.current = isStreaming;
  }, [isStreaming, liveSessions, refreshLiveSessions]);

  const activeThread = threads.find(t => t.id === activeThreadId);

  /** Start a fresh conversation, on both sides. */
  const startNewChat = useCallback(async () => {
    setIsHistoryOpen(false);
    setInputValue('');
    setActiveThreadId(newThreadId());
    hydrateMessages([]);
    await switchSession('new');
  }, [hydrateMessages, switchSession]);

  /** Reopen a stored conversation and rejoin its middleware session. */
  const openThread = useCallback(
    async (thread: ChatThread) => {
      setIsHistoryOpen(false);
      if (thread.id === activeThreadId) {
        return;
      }
      setInputValue('');
      setActiveThreadId(thread.id);
      hydrateMessages(thread.messages);
      // A thread with no recorded session (or one the middleware has since
      // dropped) still opens — the transcript is worth reading — but it gets a
      // fresh session, and the notice above the composer says the model is
      // starting from nothing.
      await switchSession(thread.serverSessionId || 'new');
      refreshLiveSessions();
    },
    [activeThreadId, hydrateMessages, switchSession, refreshLiveSessions]
  );

  const deleteThread = useCallback(
    (threadId: string) => {
      setThreads(prev => saveThreads(removeThread(prev, threadId)));
      if (threadId === activeThreadId) {
        startNewChat();
      }
    },
    [activeThreadId, startNewChat]
  );

  /** Pin the context. Called from every action that invests in the prompt. */
  const pinContext = useCallback(() => setContextMode('pinned'), []);

  /** The viewer moved to a different study than the one the prompt will send. */
  const viewerHasDiverged =
    contextMode === 'pinned' &&
    !!viewerStudyUID &&
    !!promptStudyUID &&
    viewerStudyUID !== promptStudyUID;

  /** Re-target the prompt at whatever the viewport currently shows. */
  const adoptViewerStudy = useCallback(() => {
    if (!viewerStudyUID) {
      return;
    }
    setPromptStudyUID(viewerStudyUID);
    setSelectedSeriesUIDs(new Set());
    setSliceStateBySeries({});
    reloadPromptStudy(viewerStudyUID);
    // Stay pinned while a half-written question is in the composer: the user
    // asked for THIS study, and resuming follow-mode would let the next viewport
    // change move the context out from under them again.
    if (!inputValue.trim()) {
      setContextMode('following');
    }
  }, [viewerStudyUID, reloadPromptStudy, inputValue]);

  // Series attached to the next message, in display order.
  const attachedSeries = useMemo(
    () => availableSeries.filter(s => selectedSeriesUIDs.has(s.SeriesInstanceUID)),
    [availableSeries, selectedSeriesUIDs]
  );

  const promptStudyLabel = formatStudyLabel(promptStudyInfo);
  const viewerStudyLabel = useMemo(
    () =>
      viewerHasDiverged && viewerStudyUID
        ? formatStudyLabel(collectStudy(viewerStudyUID).info)
        : '',
    [viewerHasDiverged, viewerStudyUID, collectStudy]
  );

  const sliceRecipe = useMemo(
    () => ({
      numSlices,
      strategy: sliceStrategy,
      centralPercentage: sliceStrategy === 'central' ? centralPercentage : undefined,
    }),
    [numSlices, sliceStrategy, centralPercentage]
  );

  // --- Slice range ----------------------------------------------------------

  // Where the viewport is, for the marker on the slider. Read from cornerstone,
  // not from the selection: the marker shows where the reader is, and must never
  // be mistaken for what the prompt will send.
  const viewerSlice = useViewerSlice({ activeViewportId, viewports, servicesManager });

  /**
   * Seed a slice range for each newly attached series.
   *
   * Seeded from the middleware's configured strategy rather than from the whole
   * volume, so attaching a series and pressing send keeps sampling the band the
   * service was already sampling. The slider exposes the existing recipe instead
   * of silently replacing it.
   *
   * Only series without state are touched. A later configuration change must not
   * overwrite a range the user has since set by hand.
   */
  useEffect(() => {
    const addressable = attachedSeries.filter(s =>
      canAddressSlices(s.sopInstanceUIDs, s.numImageFrames)
    );
    const missing = addressable.filter(s => !sliceStateBySeries[s.SeriesInstanceUID]);
    if (missing.length === 0) {
      return;
    }
    setSliceStateBySeries(prev => {
      const next = { ...prev };
      missing.forEach(series => {
        const total = series.numImageFrames;
        const range = initialRange(total, sliceStrategy, numSlices, centralPercentage);
        next[series.SeriesInstanceUID] = {
          range,
          count: Math.max(1, Math.min(numSlices, rangeSize(range), MAX_SLICES_PER_SERIES)),
        };
      });
      return next;
    });
  }, [attachedSeries, sliceStateBySeries, sliceStrategy, numSlices, centralPercentage]);

  /**
   * What one series will send: the selected range, the requested count, and the
   * slices that requesting that count from that range actually yields.
   *
   * `sampled` is what the panel reports and what goes on the wire — never the
   * requested count, which can exceed a narrow range.
   */
  const sliceSelectionFor = useCallback(
    (series: ChatSeriesInfo) => {
      const addressable = canAddressSlices(series.sopInstanceUIDs, series.numImageFrames);
      const state = sliceStateBySeries[series.SeriesInstanceUID];
      if (!addressable || !state) {
        return { addressable, range: null as SliceRange | null, count: 0, sampled: [] as number[] };
      }
      return {
        addressable,
        range: state.range,
        count: state.count,
        sampled: sampleSliceNumbers(state.range, state.count),
      };
    },
    [sliceStateBySeries]
  );

  /** Move a series' range. Adjusting the range is an investment in the prompt. */
  const setSeriesRange = useCallback(
    (series: ChatSeriesInfo, range: SliceRange) => {
      pinContext();
      setSliceStateBySeries(prev => {
        const current = prev[series.SeriesInstanceUID];
        const bounded = clampRange(range, series.numImageFrames);
        // Narrowing the range narrows the count with it. Left alone, the count
        // would stay above the span and the +/- buttons would appear stuck: they
        // would change a number the sampler is already ignoring.
        const count = Math.max(
          1,
          Math.min(current?.count ?? 1, rangeSize(bounded), MAX_SLICES_PER_SERIES)
        );
        return { ...prev, [series.SeriesInstanceUID]: { range: bounded, count } };
      });
    },
    [pinContext]
  );

  const setSeriesCount = useCallback(
    (series: ChatSeriesInfo, count: number) => {
      pinContext();
      setSliceStateBySeries(prev => {
        const current = prev[series.SeriesInstanceUID];
        if (!current) {
          return prev;
        }
        const bounded = Math.max(
          1,
          Math.min(count, rangeSize(current.range), MAX_SLICES_PER_SERIES)
        );
        return { ...prev, [series.SeriesInstanceUID]: { ...current, count: bounded } };
      });
    },
    [pinContext]
  );

  /** Total images the next message will carry, across every attached series. */
  const totalImagesToSend = useMemo(
    () =>
      attachedSeries.reduce((total, series) => {
        const { addressable, sampled } = sliceSelectionFor(series);
        // A series without slice addressing falls back to the configured recipe,
        // which the middleware clamps to the real volume depth.
        return total + (addressable ? sampled.length : Math.min(numSlices, series.numImageFrames));
      }, 0),
    [attachedSeries, sliceSelectionFor, numSlices]
  );

  // Handle send message
  const handleSend = useCallback(() => {
    if (!inputValue.trim() || isStreaming) {
      return;
    }

    const seriesUIDs = attachedSeries.map(s => s.SeriesInstanceUID);

    // One read of the slice state, feeding both the wire payload and the
    // snapshot. Deriving them separately is how the two could come to disagree,
    // and the snapshot's whole value is that it describes what was really sent.
    const snapshotSeries: SnapshotSeries[] = [];
    const sliceSelections: WireSliceSelection[] = [];

    attachedSeries.forEach(series => {
      const { addressable, range, sampled } = sliceSelectionFor(series);
      const entry: SnapshotSeries = {
        seriesInstanceUID: series.SeriesInstanceUID,
        description: series.SeriesDescription,
        modality: series.Modality,
        numFrames: series.numImageFrames,
      };

      if (addressable && range && sampled.length > 0) {
        entry.rangeStart = range.start;
        entry.rangeEnd = range.end;
        entry.sentSliceNumbers = [...sampled];
        sliceSelections.push({
          series_uid: series.SeriesInstanceUID,
          // 1-based slice numbers resolved to the instances at those positions.
          sop_instance_uids: sampled.map(n => series.sopInstanceUIDs[n - 1]),
          range_start: range.start,
          range_end: range.end,
          total_slices: series.numImageFrames,
        });
      }
      // Otherwise no selection is sent for this series and the middleware's
      // configured recipe applies, which is what the snapshot then reports.

      snapshotSeries.push(entry);
    });

    // Captured now, from the state in force at this instant. Everything the
    // message claims about its own context comes from here afterwards.
    const snapshot = buildPromptContextSnapshot({
      studyInstanceUID: promptStudyUID || '',
      study: promptStudyInfo,
      series: snapshotSeries,
      provider,
      model: activeModelTag,
      sliceRecipe,
    });

    sendMessage(
      inputValue.trim(),
      promptStudyUID || undefined,
      seriesUIDs.length > 0 ? seriesUIDs : undefined,
      snapshot,
      sliceSelections
    );
    setInputValue('');
    inputRef.current?.focus();
  }, [
    inputValue,
    isStreaming,
    attachedSeries,
    promptStudyUID,
    promptStudyInfo,
    provider,
    activeModelTag,
    sliceRecipe,
    sliceSelectionFor,
    sendMessage,
  ]);

  // Handle key press
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Typing invests in the prompt, so the context stops following the viewer.
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    if (e.target.value.trim()) {
      pinContext();
    }
  };

  // Toggle series selection
  const toggleSeries = (seriesUID: string) => {
    pinContext();
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

  const toggleSnapshot = (messageId: string) => {
    setExpandedSnapshotIds(prev => {
      const next = new Set(prev);
      if (next.has(messageId)) {
        next.delete(messageId);
      } else {
        next.add(messageId);
      }
      return next;
    });
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

  // ---------------------------------------------------------------------------
  // Header
  // ---------------------------------------------------------------------------

  const renderModelMenu = () => (
    <div ref={modelMenuRef}>
      <button
        type="button"
        onClick={() => setIsModelMenuOpen(o => !o)}
        title="Model"
        aria-label="Model"
        aria-haspopup="listbox"
        aria-expanded={isModelMenuOpen}
        className="border-input hover:bg-accent text-foreground flex max-w-[9rem] items-center gap-1 rounded border px-2 py-1 text-xs"
      >
        <span className="truncate">{activeModelLabel || 'No model'}</span>
        <span className="text-muted-foreground">▾</span>
      </button>

      {isModelMenuOpen && (
        <div
          role="listbox"
          className="border-input bg-muted absolute right-3 top-full z-50 mt-1 max-h-80 w-[calc(100%-1.5rem)] max-w-[20rem] overflow-y-auto rounded border shadow-lg"
        >
          <div className="text-muted-foreground px-3 pb-1 pt-2 text-[11px] font-semibold uppercase">
            Local
          </div>
          {ollamaModel ? (
            <button
              type="button"
              role="option"
              aria-selected={provider === 'local'}
              onClick={() => applyModelSelection('local', ollamaModel)}
              className="hover:bg-accent block w-full px-3 py-2 text-left"
            >
              <div className="text-foreground truncate text-xs">{ollamaModel}</div>
              <div className="text-muted-foreground text-[11px]">
                Self-hosted{provider === 'local' ? ' · in use' : ''}
              </div>
            </button>
          ) : (
            <div className="text-muted-foreground px-3 py-2 text-xs">No local model configured</div>
          )}

          <div className="text-muted-foreground border-input mt-1 border-t px-3 pb-1 pt-2 text-[11px] font-semibold uppercase">
            Ollama Cloud
          </div>
          {!cloudEnabled ? (
            <div className="text-muted-foreground px-3 py-2 text-[11px]">
              Disabled on this deployment (<code>ALLOW_CLOUD_BACKEND</code>).
            </div>
          ) : !cloudConfigured ? (
            <div className="text-muted-foreground px-3 py-2 text-[11px]">
              No API key configured (<code>OLLAMA_API_KEY</code>).
            </div>
          ) : cloudModelsLoading ? (
            <div className="text-muted-foreground px-3 py-2 text-xs">Loading models…</div>
          ) : cloudModelsError ? (
            <div className="px-3 py-2 text-[11px] text-red-300">{cloudModelsError}</div>
          ) : (
            <>
              {/* Sending a study off-site is the one thing a user must not
                  discover after the fact. */}
              <div className="px-3 pb-1 text-[11px] text-amber-300">
                Uploads slices to {cloudUrl || 'the cloud provider'}.
              </div>
              {visibleCloudModels.map(m => (
                <button
                  key={m.name}
                  type="button"
                  role="option"
                  aria-selected={provider === 'cloud' && cloudModel === m.name}
                  onClick={() => applyModelSelection('cloud', m.name)}
                  className="hover:bg-accent block w-full px-3 py-2 text-left"
                >
                  <div className="text-foreground truncate text-xs">{m.name}</div>
                  <div className="text-muted-foreground text-[11px]">
                    {cloudCapabilitiesKnown
                      ? m.supports_vision
                        ? 'Vision'
                        : 'Text only — cannot see the images'
                      : 'Capabilities unknown'}
                    {provider === 'cloud' && cloudModel === m.name ? ' · in use' : ''}
                  </div>
                </button>
              ))}
              {visionOnlyPossible && textOnlyCount > 0 && (
                <label className="text-muted-foreground border-input flex items-center gap-2 border-t px-3 py-2 text-[11px]">
                  <input
                    type="checkbox"
                    checked={showTextOnlyModels}
                    onChange={e => setShowTextOnlyModels(e.target.checked)}
                    className="accent-primary"
                  />
                  Show {textOnlyCount} text-only model{textOnlyCount === 1 ? '' : 's'}
                </label>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );

  const renderHistoryMenu = () => (
    <div ref={historyMenuRef}>
      <Button
        variant="ghost"
        size="icon"
        onClick={openHistory}
        title="Chat history"
        aria-label="Chat history"
        aria-haspopup="menu"
        aria-expanded={isHistoryOpen}
      >
        <ChatHistoryIcon className="h-5 w-5" />
      </Button>

      {isHistoryOpen && (
        <div
          role="menu"
          className="border-input bg-muted absolute right-3 top-full z-50 mt-1 max-h-96 w-[calc(100%-1.5rem)] max-w-[20rem] overflow-y-auto rounded border shadow-lg"
        >
          <button
            type="button"
            onClick={startNewChat}
            className="hover:bg-accent text-foreground border-input block w-full border-b px-3 py-2 text-left text-xs"
          >
            + New chat
          </button>

          {threads.length === 0 ? (
            <div className="text-muted-foreground px-3 py-3 text-xs">
              No earlier chats. Conversations are kept for this browser tab only.
            </div>
          ) : (
            threads.map(t => {
              const isActive = t.id === activeThreadId;
              const forgotten = isForgottenByServer(t);
              return (
                <div
                  key={t.id}
                  className={`hover:bg-accent flex items-start gap-2 px-3 py-2 ${isActive ? 'bg-primary/10' : ''}`}
                >
                  <button
                    type="button"
                    onClick={() => openThread(t)}
                    className="min-w-0 flex-1 text-left"
                  >
                    <div className="text-foreground truncate text-xs">{t.title}</div>
                    <div className="text-muted-foreground text-[11px]">
                      {formatRelativeTime(t.updatedAt)} · {t.messages.length} message
                      {t.messages.length === 1 ? '' : 's'}
                      {isActive ? ' · current' : ''}
                    </div>
                    {/* The transcript survives in this tab; the model's memory
                        does not. Say which one is gone. */}
                    {forgotten && (
                      <div className="text-[11px] text-amber-300">
                        Assistant no longer remembers this
                      </div>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteThread(t.id)}
                    title={`Delete ${t.title}`}
                    aria-label={`Delete ${t.title}`}
                    className="text-muted-foreground hover:text-foreground flex-shrink-0 text-xs"
                  >
                    ×
                  </button>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );

  const renderOverflowMenu = () => (
    <div ref={overflowMenuRef}>
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setIsOverflowMenuOpen(o => !o)}
        title="More options"
        aria-label="More options"
      >
        <span className="text-lg leading-none">⋯</span>
      </Button>

      {isOverflowMenuOpen && (
        <div className="border-input bg-muted absolute right-3 top-full z-50 mt-1 w-[calc(100%-1.5rem)] max-w-[20rem] rounded border shadow-lg">
          <button
            type="button"
            onClick={openSettings}
            title="Settings"
            className="hover:bg-accent text-foreground block w-full px-3 py-2 text-left text-xs"
          >
            Settings…
          </button>
          <button
            type="button"
            onClick={() => {
              // Discard it on both sides: the displayed transcript, its history
              // entry, and the middleware session backing it. Leaving any one
              // behind would resurrect the conversation on the next switch.
              clearHistory();
              setIsOverflowMenuOpen(false);
              deleteThread(activeThreadId);
            }}
            disabled={messages.length === 0}
            title="Clear history"
            className="hover:bg-accent text-foreground block w-full px-3 py-2 text-left text-xs disabled:opacity-50"
          >
            Clear conversation
          </button>
          {/* Debug/audit detail, not clinical information — it used to occupy a
              permanent header row for no day-to-day benefit. */}
          <div className="border-input text-muted-foreground break-all border-t px-3 py-2 text-[11px]">
            {isConnected && sessionId ? `Session: ${sessionId}` : 'Disconnected'}
          </div>
        </div>
      )}
    </div>
  );

  const renderHeader = () => (
    <div className="border-input relative flex items-center justify-between gap-2 border-b px-3 py-2">
      <span className="text-foreground truncate text-sm font-semibold">AI Assistant</span>
      <div className="flex flex-shrink-0 items-center gap-1">
        {renderModelMenu()}
        {renderHistoryMenu()}
        {renderOverflowMenu()}
      </div>
    </div>
  );

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

  // ---------------------------------------------------------------------------
  // Prompt context
  // ---------------------------------------------------------------------------

  const renderPromptContext = () => (
    <div className="border-input border-t px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wide">
          Prompt context
        </span>
        <button
          type="button"
          onClick={() => setContextMode(m => (m === 'following' ? 'pinned' : 'following'))}
          title={
            contextMode === 'following'
              ? 'Context follows the active viewport. Click to pin it.'
              : 'Context is pinned. Click to follow the active viewport again.'
          }
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[11px]"
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${contextMode === 'following' ? 'bg-highlight' : 'bg-muted-foreground'}`}
          />
          {contextMode === 'following' ? 'Following viewer' : 'Pinned'}
        </button>
      </div>

      {/* The prompt and the viewport point at different studies. Say which one
          will actually be sent, and offer the one-click correction. */}
      {viewerHasDiverged && (
        <div className="bg-amber-950/40 mb-2 rounded border border-amber-600 px-2 py-1.5 text-[11px] text-amber-200">
          <div>
            Viewer moved to <strong>{viewerStudyLabel}</strong> — this prompt still uses{' '}
            <strong>{promptStudyLabel}</strong>.
          </div>
          <button
            type="button"
            onClick={adoptViewerStudy}
            className="mt-1 underline hover:no-underline"
          >
            Use current viewer
          </button>
        </div>
      )}

      {promptStudyUID ? (
        <>
          <div className="text-foreground mb-1.5 truncate text-xs">{promptStudyLabel}</div>

          {/* One block per attached series: the chip that identifies it, then the
              range control that says what it will send. Per series because ranges
              are not comparable across acquisitions of different depth. */}
          {attachedSeries.map(series => {
            const { addressable, range, count, sampled } = sliceSelectionFor(series);
            const onThisSeries = viewerSlice.seriesInstanceUID === series.SeriesInstanceUID;
            return (
              <div
                key={series.SeriesInstanceUID}
                className="mb-1.5"
              >
                <span className="border-input bg-background text-foreground flex max-w-full items-center gap-1 rounded border px-2 py-0.5 text-[11px]">
                  <span className="truncate">
                    {series.SeriesDescription} · {series.numImageFrames} slices
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleSeries(series.SeriesInstanceUID)}
                    title={`Remove ${series.SeriesDescription}`}
                    aria-label={`Remove ${series.SeriesDescription}`}
                    className="text-muted-foreground hover:text-foreground ml-auto"
                  >
                    ×
                  </button>
                </span>

                {addressable && range ? (
                  <SliceRangeSlider
                    total={series.numImageFrames}
                    range={range}
                    count={count}
                    // Only when the viewport is showing THIS series. Marking a
                    // slice number from another acquisition would point at a
                    // position that means nothing here.
                    viewerSliceNumber={onThisSeries ? viewerSlice.sliceNumber : null}
                    seriesLabel={series.SeriesDescription}
                    onRangeChange={next => setSeriesRange(series, next)}
                    onCountChange={next => setSeriesCount(series, next)}
                  />
                ) : (
                  // Say which is true rather than hiding the control: the user
                  // needs to know a range does not apply here, and why.
                  <div className="text-muted-foreground mt-1 text-[11px]">
                    Slice range unavailable for this series — sends{' '}
                    {formatSliceRecipe(sliceRecipe)}.
                  </div>
                )}
                {addressable && sampled.length === 0 && (
                  <div className="text-[11px] text-amber-300">
                    No slices selected — this series will send no images.
                  </div>
                )}
              </div>
            );
          })}

          <div className="mb-1.5 flex flex-wrap gap-1">
            <div
              ref={seriesPickerRef}
              className="relative"
            >
              <button
                type="button"
                onClick={() => setIsSeriesPickerOpen(o => !o)}
                className="border-input hover:bg-accent text-muted-foreground rounded border border-dashed px-2 py-0.5 text-[11px]"
              >
                + Add series
              </button>
              {isSeriesPickerOpen && (
                <div className="border-input bg-muted absolute bottom-full left-0 z-50 mb-1 max-h-48 w-64 overflow-y-auto rounded border shadow-lg">
                  {availableSeries.length === 0 ? (
                    <div className="text-muted-foreground px-3 py-2 text-xs">
                      No series available
                    </div>
                  ) : (
                    availableSeries.map(s => {
                      const isSelected = selectedSeriesUIDs.has(s.SeriesInstanceUID);
                      return (
                        <button
                          key={s.SeriesInstanceUID}
                          type="button"
                          onClick={() => toggleSeries(s.SeriesInstanceUID)}
                          className="hover:bg-accent flex w-full items-start gap-2 px-3 py-2 text-left"
                        >
                          <span
                            aria-hidden="true"
                            className={`mt-0.5 h-3 w-3 flex-shrink-0 rounded border ${isSelected ? 'bg-primary border-primary' : 'border-input'}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="text-foreground block truncate text-xs">
                              {s.SeriesDescription}
                            </span>
                            <span className="text-muted-foreground block text-[11px]">
                              {s.Modality} · {s.numImageFrames} slices
                            </span>
                          </span>
                        </button>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          </div>

          {/* The one number that matters across the whole prompt: how many images
              this message will carry. */}
          <div className="text-muted-foreground text-[11px]">
            {attachedSeries.length === 0
              ? 'No series attached — the model will answer from the conversation only.'
              : `Sends ${totalImagesToSend} image${totalImagesToSend === 1 ? '' : 's'} in total`}
          </div>
        </>
      ) : (
        <div className="text-muted-foreground text-xs">No study open in the viewer.</div>
      )}
    </div>
  );

  // ---------------------------------------------------------------------------
  // Messages
  // ---------------------------------------------------------------------------

  /** The immutable record of what a message was sent with. */
  const renderSnapshot = (message: ChatMessage) => {
    const snapshot = message.promptContext;
    if (!snapshot) {
      return null;
    }
    const isExpanded = expandedSnapshotIds.has(message.id);
    const summary = formatSnapshotSummary(snapshot, shortModelLabel(snapshot.model));

    return (
      <div className="mt-1.5">
        <button
          type="button"
          onClick={() => toggleSnapshot(message.id)}
          title="What this message was sent with"
          className="text-muted-foreground hover:text-foreground flex w-full items-center gap-1 text-left text-[11px]"
        >
          <span className="truncate">{summary}</span>
          <span aria-hidden="true">{isExpanded ? '▲' : '▼'}</span>
        </button>

        {isExpanded && (
          <dl className="border-input text-muted-foreground mt-1 space-y-0.5 border-l pl-2 text-[11px]">
            <div>
              <dt className="inline font-semibold">Study: </dt>
              <dd className="inline">{snapshot.studyLabel}</dd>
            </div>
            <div>
              <dt className="inline font-semibold">Series: </dt>
              <dd className="inline">
                {snapshot.series.length > 0
                  ? snapshot.series.map(s => s.description).join(', ')
                  : 'none'}
              </dd>
            </div>
            {snapshot.series.length > 0 && (
              <>
                {/* Per series, because each carries its own range. A single
                    combined line could not say which slices came from where. */}
                {snapshot.series.map(series => (
                  <div key={series.seriesInstanceUID}>
                    <dt className="inline font-semibold">Slices: </dt>
                    <dd className="inline">
                      {snapshot.series.length > 1 && `${series.description} — `}
                      {formatSeriesSliceSource(series, snapshot.sliceRecipe)}
                      {series.sentSliceNumbers && (
                        // The individual slice numbers, so a reader can check the
                        // answer against the images rather than trusting a count.
                        <span className="block break-words">
                          {formatSliceList(series.sentSliceNumbers)}
                        </span>
                      )}
                    </dd>
                  </div>
                ))}
                <div>
                  {/* "requested", not "sent": for a recipe-based series the
                      middleware clamps to the real volume depth, so this is a
                      bound. Named slices are exact — see promptContext.ts. */}
                  <dt className="inline font-semibold">Images: </dt>
                  <dd className="inline">{snapshot.requestedImageCount} requested</dd>
                </div>
              </>
            )}
            <div>
              <dt className="inline font-semibold">Model: </dt>
              {/* Full tag, quantization included — the display name is not enough
                  to identify what ran. */}
              <dd className="inline break-all">
                {snapshot.model || 'unknown'} ({snapshot.provider})
              </dd>
            </div>
          </dl>
        )}
      </div>
    );
  };

  // Render a single message
  const renderMessage = (message: ChatMessage) => {
    // Transcript annotations (model changes) are not turns — render them as a
    // quiet rule so they read as metadata, not as something anyone said.
    if (message.role === 'event') {
      return (
        <div
          key={message.id}
          className="my-3 flex items-center gap-2"
        >
          <span className="bg-input h-px flex-1" />
          <span className="text-muted-foreground text-[11px]">{message.content}</span>
          <span className="bg-input h-px flex-1" />
        </div>
      );
    }

    const isUser = message.role === 'user';
    const isAssistant = message.role === 'assistant';
    const hasThinking = isAssistant && !!message.thinking;
    const isThinkingExpanded = hasThinking && expandedThinkingIds.has(message.id);

    return (
      <div
        key={message.id}
        className="mb-4"
      >
        <div className="mb-1 flex items-baseline justify-between gap-2">
          <span className="text-foreground text-xs font-semibold">{isUser ? 'You' : 'AI'}</span>
          <span className="text-muted-foreground text-[11px]">
            {message.timestamp.toLocaleTimeString()}
          </span>
        </div>

        <div
          className={`rounded px-3 py-2 ${isUser ? 'bg-primary/15 border-primary/40 border' : 'bg-muted'}`}
        >
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
          <div className="text-foreground break-words text-sm">
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

          {renderSnapshot(message)}
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

            {/* Backend */}
            <div className="border-input border-t pt-4">
              <h4 className="text-foreground mb-3 text-xs font-semibold">Backend</h4>

              <div className="mb-3">
                <Label className="mb-1 block text-xs">Provider</Label>
                <Select
                  value={provider}
                  onValueChange={value => setProvider(value as ProviderName)}
                >
                  <SelectTrigger aria-label="Backend provider">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">Local (self-hosted)</SelectItem>
                    {/* Only offered when the operator enabled ALLOW_CLOUD_BACKEND;
                        the middleware rejects the switch regardless, this just
                        avoids presenting a choice that cannot succeed. */}
                    {cloudEnabled && <SelectItem value="cloud">Ollama Cloud</SelectItem>}
                  </SelectContent>
                </Select>
                {!cloudEnabled && (
                  <p className="text-muted-foreground mt-1 text-xs">
                    Ollama Cloud is disabled on this deployment. An operator must set{' '}
                    <code>ALLOW_CLOUD_BACKEND=1</code> on the chat-middleware service.
                  </p>
                )}
              </div>

              {provider === 'cloud' && (
                <>
                  {/* The single most important thing a user needs to know before
                      sending a study to a hosted model. */}
                  <div className="bg-amber-950/40 mb-3 rounded border border-amber-600 px-3 py-2 text-xs text-amber-200">
                    <strong>Images leave this network.</strong> The selected DICOM slices are
                    uploaded to {cloudUrl || 'the cloud provider'} for analysis. Do not use this
                    with patient data unless your institution permits it.
                  </div>

                  {!cloudConfigured && (
                    <div className="mb-3 rounded border border-red-700 bg-red-900/50 px-3 py-2 text-xs text-red-300">
                      No API key is configured on the chat-middleware service. An operator must set{' '}
                      <code>OLLAMA_API_KEY</code>.
                    </div>
                  )}

                  <div className="mb-3">
                    <div className="mb-1 flex items-center justify-between">
                      <Label className="block text-xs">Cloud Model</Label>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={loadCloudModels}
                        disabled={cloudModelsLoading || !cloudConfigured}
                        aria-label="Refresh cloud model list"
                      >
                        {cloudModelsLoading ? 'Loading…' : 'Refresh'}
                      </Button>
                    </div>

                    {cloudModelsError && (
                      <div className="mb-2 rounded border border-red-700 bg-red-900/50 px-3 py-2 text-xs text-red-300">
                        {cloudModelsError}
                      </div>
                    )}

                    {cloudModels.length > 0 ? (
                      <Select
                        value={cloudModel}
                        onValueChange={setCloudModel}
                      >
                        <SelectTrigger aria-label="Cloud model">
                          <SelectValue placeholder="Select a model" />
                        </SelectTrigger>
                        <SelectContent>
                          {/* The label must be ONE string child, not JSX with an
                              interpolated suffix. ui-next's SelectItem only wraps
                              children in SelectPrimitive.ItemText when
                              `typeof children === 'string'`, and Radix renders the
                              trigger's SelectValue from ItemText — so any other
                              child shape leaves the closed trigger blank after a
                              selection. */}
                          {visibleCloudModels.map(m => (
                            <SelectItem
                              key={m.name}
                              value={m.name}
                            >
                              {`${m.name}${m.supports_vision ? ' — vision' : ' — text only'}`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      // Free-text fallback so a model is still selectable when the
                      // listing fails or the host returns nothing.
                      <Input
                        id="chat-cloud-model"
                        type="text"
                        value={cloudModel}
                        onChange={e => setCloudModel(e.target.value)}
                        placeholder="e.g. qwen3.5"
                      />
                    )}

                    {/* Text-only models are hidden by default rather than merely
                        flagged: alphabetically the catalogue leads with several
                        that cannot see the study, so an unfiltered list offers an
                        unusable model first. */}
                    {visionOnlyPossible && textOnlyCount > 0 && (
                      <label className="text-muted-foreground mt-2 flex items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={showTextOnlyModels}
                          onChange={e => setShowTextOnlyModels(e.target.checked)}
                          className="accent-primary"
                        />
                        Show {textOnlyCount} text-only model
                        {textOnlyCount === 1 ? '' : 's'} (cannot see the images)
                      </label>
                    )}

                    {/* This chat sends images, and many cloud models are text-only,
                        so flag a text-only pick rather than letting it fail opaquely. */}
                    {cloudCapabilitiesKnown ? (
                      selectedCloudModelInfo &&
                      !selectedCloudModelInfo.supports_vision && (
                        <p className="mt-1 text-xs text-amber-300">
                          This model has no vision capability. The chat sends DICOM slices as
                          images, so it will not be able to see the study — pick a model marked
                          “vision”.
                        </p>
                      )
                    ) : (
                      <p className="text-muted-foreground mt-1 text-xs">
                        This host did not report model capabilities, so vision support is unknown. A
                        model that cannot accept images will fail when you send a message.
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>

            {/* Local model */}
            <div>
              <Label
                htmlFor="chat-model"
                className="mb-1 block text-xs"
              >
                Local Model
              </Label>
              <Input
                id="chat-model"
                type="text"
                value={ollamaModel}
                onChange={e => setOllamaModel(e.target.value)}
                placeholder="e.g. MedAIBase/MedGemma1.5:4b"
              />
              {provider === 'cloud' && (
                <p className="text-muted-foreground mt-1 text-xs">
                  Not in use while the cloud backend is selected.
                </p>
              )}
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
        {renderHeader()}

        {modelError && (
          <div className="border-b border-red-700 bg-red-900/50 px-3 py-2 text-xs text-red-300">
            {modelError}
          </div>
        )}

        {/* Connection status */}
        {renderConnectionStatus()}

        {/* Scrollable messages + fixed context/input */}
        <div className="flex min-h-0 flex-1 flex-col">
          {/* Messages area */}
          <div className="flex-1 overflow-y-auto p-3">
            {messages.length === 0 ? (
              <div className="text-muted-foreground flex h-full flex-col items-center justify-center text-sm">
                <div className="mb-2">No messages yet</div>
                <div className="text-center text-xs">
                  Attach series below, then ask questions about your study.
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

          {/* The transcript is stored in this browser tab, the model's memory on
              the middleware — and the middleware keeps sessions in RAM only. When
              the two disagree, say so: an answer given without the earlier turns
              must not look like one that had them. */}
          {isForgottenByServer(activeThread) && (
            <div className="bg-amber-950/40 mx-3 mb-2 rounded border border-amber-600 px-3 py-2 text-[11px] text-amber-200">
              The assistant no longer has this conversation in memory (the chat service restarted).
              The messages above are still shown, but the next question will be answered without
              them.
            </div>
          )}

          {/* Prompt context sits directly above the composer: it describes what
              the next message will carry, not what past ones did. */}
          {renderPromptContext()}

          {/* Input area */}
          <div className="border-input border-t p-3">
            <div className="flex gap-2">
              <textarea
                ref={inputRef}
                value={inputValue}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                placeholder={isConnected ? 'Ask about these images...' : 'Connecting...'}
                disabled={!isConnected}
                rows={2}
                className={`${TEXTAREA_CLASS} flex-1 resize-none`}
              />
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
                  ➤
                </Button>
              )}
            </div>
            <p className="text-muted-foreground mt-1.5 text-center text-[11px]">
              AI responses are experimental and not a substitute for professional judgment.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
