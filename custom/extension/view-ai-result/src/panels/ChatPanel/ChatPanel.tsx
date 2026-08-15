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
import { CapturedRoi, useChatRoiCapture } from '../../hooks/useChatRoiCapture';
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
  clampRange,
  initialRange,
  MAX_SLICES_PER_SERIES,
  rangeSize,
  sampleSliceNumbers,
  SliceRange,
} from '../../utils/sliceSelection';
import {
  canAddressAxis,
  formatAxisShape,
  phaseCount,
  phaseInstances,
  positionOf,
  sliceAxisOf,
} from '../../utils/sliceAxis';
import SliceRangeSlider from './SliceRangeSlider';
import {
  ChatRoi,
  formatRoiLabel,
  formatRoiRect,
  formatRoiScope,
  RoiScope,
  slicesForRoi,
} from '../../utils/chatRoi';
import {
  ensureChatRoiTool,
  removeChatRoi,
  startDrawingRoi,
  stopDrawingRoi,
} from '../../utils/chatRoiTool';

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
  // Keyed by displaySetInstanceUID, not SeriesInstanceUID: OHIF splits some
  // series into several display sets (one per instance for mammography and other
  // single-image modalities), and keying on the series would make two distinct
  // images attach and detach as one.
  const [selectedDisplaySetUIDs, setSelectedDisplaySetUIDs] = useState<Set<string>>(new Set());
  const [contextMode, setContextMode] = useState<ContextMode>('following');
  const [isSeriesPickerOpen, setIsSeriesPickerOpen] = useState(false);
  // Per-series slice selection, keyed by SeriesInstanceUID. Per-series rather
  // than one global range because attached series differ in depth: "18-62" means
  // nothing shared between a 103-slice and a 24-slice acquisition.
  const [sliceStateByDisplaySet, setSliceStateByDisplaySet] = useState<
    Record<string, { range: SliceRange; count: number; phaseIndex: number }>
  >({});
  // The chat's own region of interest. One at a time: a second rectangle would
  // raise a question the prompt cannot answer — which region is the question
  // about? — and the panel would have to guess.
  const [chatRoi, setChatRoi] = useState<ChatRoi | null>(null);
  const [roiScope, setRoiScope] = useState<RoiScope>('slice');
  const [isDrawingRoi, setIsDrawingRoi] = useState(false);
  const [roiError, setRoiError] = useState<string | null>(null);
  // The tool that held the primary mouse button before drawing started, so it
  // can have it back.
  const displacedToolRef = useRef<string | null>(null);
  // Held in a ref so the study-tracking effects above can discard a region
  // without taking a dependency on a callback defined below them.
  const clearRoiRef = useRef<(() => void) | null>(null);
  const endDrawingRef = useRef<(() => void) | null>(null);

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
      info.AccessionNumber = tags.AccessionNumber;

      const series: ChatSeriesInfo[] = studyDisplaySets.map((ds: any) => {
        const instances: any[] = ds.images || ds.instances || [];
        return {
          displaySetInstanceUID: ds.displaySetInstanceUID,
          SeriesInstanceUID: ds.SeriesInstanceUID,
          SeriesDescription: ds.SeriesDescription || `Series ${ds.SeriesNumber || 'N/A'}`,
          SeriesNumber: ds.SeriesNumber || 0,
          Modality: ds.Modality || 'Unknown',
          numImageFrames: ds.numImageFrames || instances.length || 0,
          // The axis the viewer scrolls, not the raw instance list: on a 4D series
          // those are different lengths, differently ordered, and interleaved by
          // contrast phase. See `sliceAxis.ts`.
          axis: sliceAxisOf(ds),
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
      setSelectedDisplaySetUIDs(new Set());
      setSliceStateByDisplaySet({});
      endDrawingRef.current?.();
      clearRoiRef.current?.();
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
    setSelectedDisplaySetUIDs(new Set());
    setSliceStateByDisplaySet({});
    endDrawingRef.current?.();
    clearRoiRef.current?.();
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
    () => availableSeries.filter(s => selectedDisplaySetUIDs.has(s.displaySetInstanceUID)),
    [availableSeries, selectedDisplaySetUIDs]
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
   * Keep a slice range in step with each attached series.
   *
   * Seeds a range from the middleware's configured strategy when one is missing,
   * so attaching a series and pressing send keeps sampling the band the service
   * was already sampling — the slider exposes the existing recipe rather than
   * silently replacing it.
   *
   * Also RE-CLAMPS a range whose series has changed depth underneath it. Display
   * sets hydrate progressively and can be replaced in place, so a range set
   * against 100 slices can find itself on a 60-slice series; left alone it would
   * address instances past the end of the list.
   *
   * A range the user set is otherwise left alone — a later configuration change
   * must not overwrite it.
   */
  useEffect(() => {
    const addressable = attachedSeries.filter(s => canAddressAxis(s.axis, s.numImageFrames));
    const stale = addressable.filter(series => {
      const state = sliceStateByDisplaySet[series.displaySetInstanceUID];
      if (!state) {
        return true;
      }
      const bounded = clampRange(state.range, series.axis.sliceCount);
      const boundedPhase = Math.min(state.phaseIndex, phaseCount(series.axis) - 1);
      return (
        bounded.start !== state.range.start ||
        bounded.end !== state.range.end ||
        boundedPhase !== state.phaseIndex
      );
    });
    if (stale.length === 0) {
      return;
    }
    setSliceStateByDisplaySet(prev => {
      const next = { ...prev };
      stale.forEach(series => {
        // The axis, not the frame count: on a 4D series they differ by the number
        // of phases, and a range seeded against 155 would select five times the
        // anatomy the user sees.
        const total = series.axis.sliceCount;
        const existing = prev[series.displaySetInstanceUID];
        // An existing range is clamped, not discarded: the user chose it, and the
        // nearest valid range is closer to their intent than a reset.
        const range = existing
          ? clampRange(existing.range, total)
          : initialRange(total, sliceStrategy, numSlices, centralPercentage);
        // A new series opens on whichever phase the viewport is already showing,
        // so the panel describes the image the reader is looking at.
        const seeded =
          existing?.phaseIndex ??
          (viewerSlice.displaySetInstanceUID === series.displaySetInstanceUID &&
          viewerSlice.phaseNumber
            ? viewerSlice.phaseNumber - 1
            : 0);
        next[series.displaySetInstanceUID] = {
          range,
          count: Math.max(
            1,
            Math.min(existing?.count ?? numSlices, rangeSize(range), MAX_SLICES_PER_SERIES)
          ),
          phaseIndex: Math.min(Math.max(0, seeded), phaseCount(series.axis) - 1),
        };
      });
      return next;
    });
  }, [
    attachedSeries,
    sliceStateByDisplaySet,
    sliceStrategy,
    numSlices,
    centralPercentage,
    viewerSlice,
  ]);

  /**
   * What one series will send: the selected range, the requested count, and the
   * slices that requesting that count from that range actually yields.
   *
   * The range is clamped against the series' CURRENT depth on every read, so a
   * series that shrank between compose and send can never yield a slice number
   * with no instance behind it.
   *
   * `sampled` is what the panel reports and what goes on the wire — never the
   * requested count, which can exceed a narrow range.
   */
  const sliceSelectionFor = useCallback(
    (series: ChatSeriesInfo) => {
      const addressable = canAddressAxis(series.axis, series.numImageFrames);
      const state = sliceStateByDisplaySet[series.displaySetInstanceUID];
      if (!addressable || !state) {
        return {
          addressable,
          range: null as SliceRange | null,
          count: 0,
          sampled: [] as number[],
          phaseIndex: 0,
          instances: [] as string[],
        };
      }
      const range = clampRange(state.range, series.axis.sliceCount);
      // Clamped on read as well as on write: a display set can be replaced in
      // place with one that has fewer phases.
      const phaseIndex = Math.min(Math.max(0, state.phaseIndex), phaseCount(series.axis) - 1);
      return {
        addressable,
        range,
        count: state.count,
        sampled: sampleSliceNumbers(range, state.count),
        phaseIndex,
        instances: phaseInstances(series.axis, phaseIndex),
      };
    },
    [sliceStateByDisplaySet]
  );

  /** Choose which contrast phase of a 4D series the message sends. */
  const setSeriesPhase = useCallback(
    (series: ChatSeriesInfo, phaseIndex: number) => {
      pinContext();
      setSliceStateByDisplaySet(prev => {
        const current = prev[series.displaySetInstanceUID];
        if (!current) {
          return prev;
        }
        const bounded = Math.min(Math.max(0, phaseIndex), phaseCount(series.axis) - 1);
        return { ...prev, [series.displaySetInstanceUID]: { ...current, phaseIndex: bounded } };
      });
    },
    [pinContext]
  );

  /** Move a series' range. Adjusting the range is an investment in the prompt. */
  const setSeriesRange = useCallback(
    (series: ChatSeriesInfo, range: SliceRange) => {
      pinContext();
      setSliceStateByDisplaySet(prev => {
        const current = prev[series.displaySetInstanceUID];
        const bounded = clampRange(range, series.axis.sliceCount);
        // Narrowing the range narrows the count with it. Left alone, the count
        // would stay above the span and the +/- buttons would appear stuck: they
        // would change a number the sampler is already ignoring.
        const count = Math.max(
          1,
          Math.min(current?.count ?? 1, rangeSize(bounded), MAX_SLICES_PER_SERIES)
        );
        return {
          ...prev,
          // The phase is carried through: moving the range says nothing about
          // which contrast phase the question is about.
          [series.displaySetInstanceUID]: {
            range: bounded,
            count,
            phaseIndex: current?.phaseIndex ?? 0,
          },
        };
      });
    },
    [pinContext]
  );

  const setSeriesCount = useCallback(
    (series: ChatSeriesInfo, count: number) => {
      pinContext();
      setSliceStateByDisplaySet(prev => {
        const current = prev[series.displaySetInstanceUID];
        if (!current) {
          return prev;
        }
        const bounded = Math.max(
          1,
          Math.min(count, rangeSize(current.range), MAX_SLICES_PER_SERIES)
        );
        return { ...prev, [series.displaySetInstanceUID]: { ...current, count: bounded } };
      });
    },
    [pinContext]
  );

  // --- Chat region of interest ---------------------------------------------

  /** Discard the region, on screen and in the prompt. */
  const clearRoi = useCallback(() => {
    setChatRoi(prev => {
      if (prev) {
        removeChatRoi(prev.annotationUID);
      }
      return null;
    });
    setRoiError(null);
  }, []);

  clearRoiRef.current = clearRoi;

  /** Stop drawing and hand the primary mouse button back. */
  const endDrawing = useCallback(() => {
    setIsDrawingRoi(false);
    stopDrawingRoi(displacedToolRef.current);
    displacedToolRef.current = null;
  }, []);

  // Held in a ref for the same reason as `clearRoi`: the study-tracking effects
  // are defined above this and must be able to abandon a half-drawn region
  // without depending on a callback declared below them. Leaving drawing active
  // would strand the primary mouse button on the region tool.
  endDrawingRef.current = endDrawing;

  const beginDrawing = useCallback(() => {
    // Drawing a region is an investment in the prompt, like typing in it.
    pinContext();
    setRoiError(null);
    // A second rectangle on screen with only one in the prompt would be a lie
    // about what the message carries.
    clearRoi();
    if (!ensureChatRoiTool()) {
      setRoiError('Region drawing is unavailable in this viewer layout.');
      return;
    }
    displacedToolRef.current = startDrawingRoi();
    setIsDrawingRoi(true);
  }, [pinContext, clearRoi]);

  /**
   * Adopt a finished rectangle.
   *
   * The slice it belongs to is resolved through the same SOPInstanceUID scheme
   * the slice range uses, so a region and a range always speak about slices the
   * same way. Cornerstone failing to name the instance falls back to the
   * viewport's own position, which is where the user was drawing.
   *
   * On a 4D series the region is recorded as an *anatomical* slice, not as a
   * phase-and-slice pair. The phases of one slice are the same anatomy imaged at
   * different times, on the same pixel grid, so a fractional rectangle drawn on
   * one is valid on all of them — and a region that stopped applying the moment
   * the reader switched phase would be a worse surprise than one that follows.
   * Which phase actually got cropped is recorded in the message snapshot.
   */
  const adoptRoi = useCallback(
    (captured: CapturedRoi) => {
      endDrawing();

      const host = attachedSeries.find(series =>
        captured.sopInstanceUID
          ? positionOf(series.axis, captured.sopInstanceUID) !== null
          : series.displaySetInstanceUID === viewerSlice.displaySetInstanceUID
      );
      if (!host) {
        setRoiError('Attach the series you drew on before adding a region to the prompt.');
        removeChatRoi(captured.annotationUID);
        return;
      }

      const position = positionOf(host.axis, captured.sopInstanceUID);
      const sliceNumber = position?.sliceNumber ?? viewerSlice.sliceNumber ?? 1;

      setChatRoi({
        displaySetInstanceUID: host.displaySetInstanceUID,
        sliceNumber,
        rect: captured.rect,
        annotationUID: captured.annotationUID,
      });
      setRoiError(null);
    },
    [attachedSeries, viewerSlice, endDrawing]
  );

  const rejectRoi = useCallback(
    (reason: string, annotationUID: string | null) => {
      endDrawing();
      // The rectangle exists on the image even though the panel refused it;
      // leaving it would be an orphan the user cannot remove from the chat.
      if (annotationUID) {
        removeChatRoi(annotationUID);
      }
      setRoiError(reason);
    },
    [endDrawing]
  );

  /** The region was reshaped on the image; the prompt has to follow it. */
  const updateRoi = useCallback((captured: CapturedRoi) => {
    setChatRoi(prev =>
      prev && prev.annotationUID === captured.annotationUID
        ? { ...prev, rect: captured.rect }
        : prev
    );
  }, []);

  /**
   * The region disappeared from the image without the panel doing it.
   *
   * A chat region is stored as an unmapped measurement (see `chatRoiTool.ts`), so
   * a clinical "clear measurements" deletes it. Dropping it here is what stops the
   * next message being cropped to a rectangle that is no longer on screen.
   */
  const forgetRoi = useCallback(() => {
    setChatRoi(null);
    setRoiError('The region was removed from the image, so it is no longer attached.');
  }, []);

  useChatRoiCapture({
    isDrawing: isDrawingRoi,
    trackedAnnotationUID: chatRoi?.annotationUID ?? null,
    onCaptured: adoptRoi,
    onUpdated: updateRoi,
    onRemoved: forgetRoi,
    onRejected: rejectRoi,
  });

  // On unmount: release the mouse button, and take the rectangle with it. A
  // region left on the image after the panel is gone belongs to nothing.
  const chatRoiRef = useRef<ChatRoi | null>(null);
  chatRoiRef.current = chatRoi;
  useEffect(
    () => () => {
      stopDrawingRoi(displacedToolRef.current);
      if (chatRoiRef.current) {
        removeChatRoi(chatRoiRef.current.annotationUID);
      }
    },
    []
  );

  /** A region belongs to one series; other series are unaffected by it. */
  const roiForSeries = useCallback(
    (series: ChatSeriesInfo): ChatRoi | null =>
      chatRoi && chatRoi.displaySetInstanceUID === series.displaySetInstanceUID ? chatRoi : null,
    [chatRoi]
  );

  /**
   * The slices one series will actually send, region included.
   *
   * A region scoped to its own slice overrides the range: the question is about
   * that region on that slice, and sending the rest of the range as well would
   * answer a different question.
   */
  const effectiveSlicesFor = useCallback(
    (series: ChatSeriesInfo): number[] => {
      const { addressable, sampled } = sliceSelectionFor(series);
      if (!addressable) {
        return [];
      }
      const roi = roiForSeries(series);
      return roi ? slicesForRoi(roiScope, roi.sliceNumber, sampled) : sampled;
    },
    [sliceSelectionFor, roiForSeries, roiScope]
  );

  /** Total images the next message will carry, across every attached series. */
  const totalImagesToSend = useMemo(
    () =>
      attachedSeries.reduce((total, series) => {
        const { addressable } = sliceSelectionFor(series);
        // A series without slice addressing falls back to the configured recipe,
        // which the middleware clamps to the real volume depth.
        return (
          total +
          (addressable
            ? effectiveSlicesFor(series).length
            : Math.min(numSlices, series.numImageFrames))
        );
      }, 0),
    [attachedSeries, sliceSelectionFor, effectiveSlicesFor, numSlices]
  );

  // Handle send message
  const handleSend = useCallback(() => {
    if (!inputValue.trim() || isStreaming) {
      return;
    }

    // Series UIDs are what the middleware retrieves by, and two display sets can
    // share one, so the list is de-duplicated while keeping display order.
    const seriesUIDs = [...new Set(attachedSeries.map(s => s.SeriesInstanceUID))];

    // One read of the slice state, feeding both the wire payload and the
    // snapshot. Deriving them separately is how the two could come to disagree,
    // and the snapshot's whole value is that it describes what was really sent.
    const snapshotSeries: SnapshotSeries[] = [];
    const sliceSelections: WireSliceSelection[] = [];

    attachedSeries.forEach(series => {
      const { addressable, range, phaseIndex, instances } = sliceSelectionFor(series);
      const roi = roiForSeries(series);
      // The region can narrow what a series sends — scoped to its own slice it
      // replaces the range entirely — so this, not the raw sample, is what goes
      // out and what the snapshot records.
      const sent = effectiveSlicesFor(series);
      const entry: SnapshotSeries = {
        displaySetInstanceUID: series.displaySetInstanceUID,
        seriesInstanceUID: series.SeriesInstanceUID,
        description: series.SeriesDescription,
        modality: series.Modality,
        numFrames: series.numImageFrames,
      };

      // `sliceSelectionFor` clamps against the current instance list, so every
      // sampled number has an instance behind it. Filtered anyway, and the
      // selection dropped if anything is missing: sending `null` in place of a
      // SOPInstanceUID would have the middleware reject the whole turn.
      const instanceUIDs = addressable ? sent.map(n => instances[n - 1]).filter(Boolean) : [];

      if (addressable && range && sent.length > 0 && instanceUIDs.length === sent.length) {
        entry.rangeStart = range.start;
        entry.rangeEnd = range.end;
        entry.sentSliceNumbers = [...sent];
        entry.sliceCount = series.axis.sliceCount;
        if (phaseCount(series.axis) > 1) {
          entry.phaseNumber = phaseIndex + 1;
          entry.phaseCount = phaseCount(series.axis);
        }
        if (roi) {
          entry.roi = { ...roi.rect, sliceNumber: roi.sliceNumber, scope: roiScope };
        }
        sliceSelections.push({
          series_uid: series.SeriesInstanceUID,
          sop_instance_uids: instanceUIDs,
          range_start: range.start,
          range_end: range.end,
          // The axis the range was expressed on, so the middleware's own record of
          // the turn agrees with the panel's. On a 4D series this is the slice
          // count, not the 5x larger instance count.
          total_slices: series.axis.sliceCount,
          roi: roi ? { ...roi.rect } : undefined,
        });
      } else {
        // No slice range applies. The recipe travels with the message so the
        // middleware uses the one this panel is showing, rather than whatever its
        // global config happens to hold when the turn runs.
        //
        // The region still travels: the middleware crops whatever slices it ends
        // up sending, however it chose them. Dropping it here would leave a
        // region on screen and in the chip that never reached the model — which
        // is precisely the silent disagreement the snapshot exists to prevent.
        // It cannot be confined to one slice without addressing, so it covers
        // every slice sent, and the panel says so.
        if (roi) {
          entry.roi = { ...roi.rect, sliceNumber: roi.sliceNumber, scope: 'range' };
        }
        sliceSelections.push({
          series_uid: series.SeriesInstanceUID,
          sop_instance_uids: [],
          num_slices: sliceRecipe.numSlices,
          slice_strategy: sliceRecipe.strategy,
          central_percentage: sliceRecipe.centralPercentage,
          roi: roi ? { ...roi.rect } : undefined,
        });
      }

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
    effectiveSlicesFor,
    roiForSeries,
    roiScope,
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
  const toggleSeries = (displaySetUID: string) => {
    pinContext();
    // A region belongs to a slice of a series. Detaching the series without it
    // would leave a rectangle on screen that no longer reaches the model.
    if (chatRoi?.displaySetInstanceUID === displaySetUID) {
      clearRoi();
    }
    // And a half-drawn region has to be abandoned: the cancel control is only
    // shown while a series is attached, so detaching the last one would leave
    // the primary mouse button on the region tool with no way back.
    if (isDrawingRoi) {
      endDrawing();
    }
    setSelectedDisplaySetUIDs(prev => {
      const newSet = new Set(prev);
      if (newSet.has(displaySetUID)) {
        newSet.delete(displaySetUID);
      } else {
        newSet.add(displaySetUID);
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
              ? 'The study below follows the active viewport. Series are never attached for you. Click to pin the study.'
              : 'The study below is pinned. Click to let it follow the active viewport again.'
          }
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-[11px]"
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${contextMode === 'following' ? 'bg-highlight' : 'bg-muted-foreground'}`}
          />
          {/* Named for what it governs. "Following viewer" read as a promise to
              track everything on screen — including which series to send — when
              all it does is choose which STUDY the prompt targets. */}
          {contextMode === 'following' ? 'Study: follows viewer' : 'Study: pinned'}
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
            const { addressable, range, count, sampled, phaseIndex } = sliceSelectionFor(series);
            const seriesRoi = roiForSeries(series);
            const phases = phaseCount(series.axis);
            const onThisSeries = viewerSlice.displaySetInstanceUID === series.displaySetInstanceUID;
            // Which phase the viewport is on, when it is on this series at all.
            // Only ever an offer — adopting it automatically would let scrolling
            // rewrite the question mid-compose.
            const viewerPhaseIndex =
              onThisSeries && viewerSlice.phaseNumber ? viewerSlice.phaseNumber - 1 : null;
            return (
              <div
                key={series.displaySetInstanceUID}
                className="mb-1.5"
              >
                <span className="border-input bg-background text-foreground flex max-w-full items-center gap-1 rounded border px-2 py-0.5 text-[11px]">
                  <span className="truncate">
                    {series.SeriesDescription} ·{' '}
                    {addressable ? formatAxisShape(series.axis) : `${series.numImageFrames} images`}
                  </span>
                  <button
                    type="button"
                    onClick={() => toggleSeries(series.displaySetInstanceUID)}
                    title={`Remove ${series.SeriesDescription}`}
                    aria-label={`Remove ${series.SeriesDescription}`}
                    className="text-muted-foreground hover:text-foreground ml-auto"
                  >
                    ×
                  </button>
                </span>

                {/* Which contrast phase the question is about. Only for a series
                    that has more than one: on a dynamic study the phase decides
                    what the images mean, and leaving it implicit is how five
                    slices from five different phases got sent as though they
                    were one acquisition. */}
                {addressable && phases > 1 && (
                  <div className="text-muted-foreground mt-1 flex items-center gap-1 text-[11px]">
                    <label htmlFor={`phase-${series.displaySetInstanceUID}`}>
                      {series.axis.splittingTag === 'TemporalPositionIdentifier'
                        ? 'Contrast phase'
                        : 'Phase'}
                    </label>
                    <select
                      id={`phase-${series.displaySetInstanceUID}`}
                      aria-label={`Contrast phase for ${series.SeriesDescription}`}
                      className="border-input bg-background text-foreground rounded border px-1 py-0.5"
                      value={phaseIndex}
                      onChange={e => setSeriesPhase(series, Number(e.target.value))}
                    >
                      {Array.from({ length: phases }, (_, i) => (
                        <option
                          key={i}
                          value={i}
                        >
                          {i + 1} of {phases}
                        </option>
                      ))}
                    </select>
                    {viewerPhaseIndex !== null && viewerPhaseIndex !== phaseIndex && (
                      <button
                        type="button"
                        onClick={() => setSeriesPhase(series, viewerPhaseIndex)}
                        className="text-primary underline"
                        title={`The viewport is showing phase ${viewerPhaseIndex + 1}`}
                      >
                        use phase {viewerPhaseIndex + 1}
                      </button>
                    )}
                  </div>
                )}

                {addressable && range ? (
                  <SliceRangeSlider
                    total={series.axis.sliceCount}
                    range={range}
                    count={count}
                    // Only when the viewport is showing THIS series: a slice
                    // number from another acquisition would point at a position
                    // that means nothing here. The marker follows the anatomy
                    // across phases, because anatomy is the axis the slider is.
                    viewerSliceNumber={onThisSeries ? viewerSlice.sliceNumber : null}
                    seriesLabel={series.SeriesDescription}
                    onRangeChange={next => setSeriesRange(series, next)}
                    onCountChange={next => setSeriesCount(series, next)}
                  />
                ) : (
                  // Say which is true rather than hiding the control: the user
                  // needs to know a range does not apply here, and why.
                  <div className="text-muted-foreground mt-1 text-[11px]">
                    Slice range unavailable for this series — sends {formatSliceRecipe(sliceRecipe)}
                    .
                  </div>
                )}
                {addressable && sampled.length === 0 && (
                  <div className="text-[11px] text-amber-300">
                    No slices selected — this series will send no images.
                  </div>
                )}

                {/* The region, and how far it reaches. Directly under the range
                    it modifies, because scoped to one slice it replaces it. */}
                {seriesRoi && (
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
                    <span className="bg-amber-950/40 flex items-center gap-1 rounded border border-amber-500 px-2 py-0.5 text-amber-200">
                      <span className="truncate">{formatRoiLabel(seriesRoi.sliceNumber)}</span>
                      <button
                        type="button"
                        onClick={clearRoi}
                        title="Remove region"
                        aria-label="Remove region"
                        className="hover:text-foreground"
                      >
                        ×
                      </button>
                    </span>
                    {addressable ? (
                      <label className="text-muted-foreground flex items-center gap-1">
                        Apply to
                        <select
                          value={roiScope}
                          onChange={e => {
                            pinContext();
                            setRoiScope(e.target.value as RoiScope);
                          }}
                          aria-label="Apply region to"
                          className="border-input bg-background text-foreground rounded border px-1 py-0.5 text-[11px]"
                        >
                          <option value="slice">{formatRoiScope('slice')}</option>
                          <option value="range">{formatRoiScope('range')}</option>
                        </select>
                      </label>
                    ) : (
                      // Confining a region to one slice needs slice addressing,
                      // which this series does not offer. Offering the choice
                      // anyway would be offering something that does nothing.
                      <span className="text-muted-foreground">Applies to every slice sent</span>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          <div className="mb-1.5 flex flex-wrap items-start gap-1">
            {/* A chat-specific region tool, not the annotation pen. What is drawn
                here is a question, not a finding: it never enters the measurement
                record and renders dashed so it cannot be read as one. */}
            {(isDrawingRoi || (attachedSeries.length > 0 && !chatRoi)) &&
              (isDrawingRoi ? (
                <button
                  type="button"
                  onClick={endDrawing}
                  className="rounded border border-amber-500 px-2 py-0.5 text-[11px] text-amber-200"
                >
                  Drag on the image… (cancel)
                </button>
              ) : (
                <button
                  type="button"
                  onClick={beginDrawing}
                  title="Draw a region to ask about"
                  className="border-input hover:bg-accent text-muted-foreground rounded border border-dashed px-2 py-0.5 text-[11px]"
                >
                  ▱ Select region
                </button>
              ))}

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
                      const isSelected = selectedDisplaySetUIDs.has(s.displaySetInstanceUID);
                      return (
                        <button
                          key={s.displaySetInstanceUID}
                          type="button"
                          onClick={() => toggleSeries(s.displaySetInstanceUID)}
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
                              {s.Modality} ·{' '}
                              {s.axis.sliceCount > 0
                                ? formatAxisShape(s.axis)
                                : `${s.numImageFrames} images`}
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

          {roiError && <div className="mb-1 text-[11px] text-amber-300">{roiError}</div>}

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

  /**
   * Images from earlier turns that the model can still see, per message.
   *
   * The middleware replays conversation history verbatim, and a stored user turn
   * carries its slice images. So the model answering question 3 is looking at
   * question 1's and 2's images as well — which a footer saying "5 images" would
   * otherwise flatly contradict.
   *
   * Turns that failed are excluded: the middleware commits a turn to history only
   * after it generates an answer, so nothing was retained from those.
   */
  const carriedImagesByMessage = useMemo(() => {
    const carried = new Map<string, number>();
    let running = 0;
    messages.forEach(message => {
      if (message.role !== 'user') {
        return;
      }
      carried.set(message.id, running);
      if (!message.deliveryFailed) {
        running += message.promptContext?.requestedImageCount ?? 0;
      }
    });
    // The assistant message answering a question shares its carried count.
    messages.forEach((message, index) => {
      if (message.role === 'assistant' && index > 0) {
        const question = messages[index - 1];
        if (question?.role === 'user' && carried.has(question.id)) {
          carried.set(message.id, carried.get(question.id) as number);
        }
      }
    });
    return carried;
  }, [messages]);

  /** The immutable record of what a message was sent with. */
  const renderSnapshot = (message: ChatMessage) => {
    const snapshot = message.promptContext;
    if (!snapshot) {
      return null;
    }
    const isExpanded = expandedSnapshotIds.has(message.id);
    const carriedImages = carriedImagesByMessage.get(message.id) ?? 0;
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

        {/* The snapshot describes a request, and this request produced no answer.
            Without saying so, the slice list reads as a record of images an answer
            was actually derived from. */}
        {message.deliveryFailed && (
          <div className="text-[11px] text-amber-300">Requested, but no answer was produced</div>
        )}

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
                  <div key={series.displaySetInstanceUID || series.seriesInstanceUID}>
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
                      {series.roi && (
                        // A cropped image answers a different question from a
                        // whole slice; scrolling back must show which it was.
                        <span className="block break-words text-amber-300">
                          Region from slice {series.roi.sliceNumber} ({formatRoiRect(series.roi)}),
                          applied to {formatRoiScope(series.roi.scope).toLowerCase()}
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
            {carriedImages > 0 && (
              // The model is not looking only at this message's images.
              <div>
                <dt className="inline font-semibold">Also in context: </dt>
                <dd className="inline">
                  {carriedImages} image{carriedImages === 1 ? '' : 's'} from earlier messages
                </dd>
              </div>
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
