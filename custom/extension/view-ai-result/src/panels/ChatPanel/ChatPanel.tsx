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
  formatContextSummary,
  formatStudyLabel,
  formatWindow,
  StudyLabelSource,
} from '../../utils/promptContext';
import {
  clampRange,
  initialRange,
  MAX_SLICES_PER_SERIES,
  rangeAroundSlice,
  rangeSize,
  sampleSliceNumbers,
  SliceRange,
} from '../../utils/sliceSelection';
import {
  canAddressAxis,
  formatAxisShape,
  dimensionGroupCount,
  groupNoun,
  dimensionGroupInstances,
  positionOf,
  sliceAxisOf,
} from '../../utils/sliceAxis';
import SliceRangeSlider from './SliceRangeSlider';
import { ChatRoi, formatRoiLabel, formatRoiRect, formatRoiScope } from '../../utils/chatRoi';
import {
  ensureChatRoiTool,
  moveChatRoiToViewportSlice,
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

/** Session-scoped, like the disclaimer banner: a layout preference, not a setting. */
const CONTEXT_COLLAPSED_KEY = 'odelia.chat.contextCollapsed.v1';

/**
 * Which models the header menu offers, as `provider:name`.
 *
 * localStorage, not session: which models a department uses is a standing
 * choice, and re-pruning a fifty-model cloud catalogue every morning is not one
 * anybody would make twice.
 */
const ENABLED_MODELS_KEY = 'odelia.chat.enabledModels.v1';

/** Whether messages render through the viewer's window. Session-scoped. */
const USE_VIEWER_WINDOW_KEY = 'odelia.chat.useViewerWindow.v1';

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
  // Whether the prompt-context section is folded away. Read from session storage
  // in an effect rather than in the initializer so the first render is identical
  // on every mount — and open by default, because a reader who has never folded
  // it should see what their next message will send.
  const [isContextCollapsed, setIsContextCollapsed] = useState(false);
  /**
   * Whether to render the message's images through the viewer's window.
   *
   * On by default: the window a radiologist sets is a clinical decision, and a
   * service that ignores it answers about a different image. Turning it off
   * falls back to the middleware auto-windowing each slice on its own
   * percentiles — useful when the viewport window is a display preference rather
   * than a diagnostic one, and the only behaviour available before this existed.
   */
  const [useViewerWindow, setUseViewerWindow] = useState(true);
  // Per-series slice selection, keyed by SeriesInstanceUID. Per-series rather
  // than one global range because attached series differ in depth: "18-62" means
  // nothing shared between a 103-slice and a 24-slice acquisition.
  const [sliceStateByDisplaySet, setSliceStateByDisplaySet] = useState<
    Record<string, { range: SliceRange; count: number; groupIndex: number }>
  >({});
  // The chat's own region of interest. One at a time: a second rectangle would
  // raise a question the prompt cannot answer — which region is the question
  // about? — and the panel would have to guess.
  const [chatRoi, setChatRoi] = useState<ChatRoi | null>(null);
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

  // Model state. `ollamaModel` is whichever local model the middleware is
  // currently pointed at; the list of local models comes from the server.
  const [ollamaModel, setOllamaModel] = useState('');
  const [localModels, setLocalModels] = useState<CloudModelInfo[]>([]);
  const [localModelsLoading, setLocalModelsLoading] = useState(false);
  const [localModelsError, setLocalModelsError] = useState<string | null>(null);
  // Whether a listing has been attempted at all. Guarding the fetch effect on
  // `models.length === 0` instead would refetch forever against a host that
  // answers 200 with an empty list, since that leaves every other signal false.
  const [localModelsFetched, setLocalModelsFetched] = useState(false);
  /**
   * Which models the chat's model menu offers, as `provider:name`.
   *
   * This is what the settings panel is for. Choosing a model there was doing the
   * same job as the header menu — and losing to it, since the header menu wins
   * whenever it is used — so the setting is now which models the header menu may
   * offer at all. A deployment with fifty cloud models becomes a list of the two
   * a department actually uses.
   *
   * Empty means "not chosen yet", which shows everything. It is deliberately not
   * the same as "none selected": a stored empty set would leave a user with no
   * models and no obvious way back.
   */
  const [enabledModelKeys, setEnabledModelKeys] = useState<Set<string>>(new Set());

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
  const [cloudModelsFetched, setCloudModelsFetched] = useState(false);
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
  const historyMenuRef = useRef<HTMLDivElement>(null);

  useDismissOnOutside(modelMenuRef, isModelMenuOpen, () => setIsModelMenuOpen(false));
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
  /** Ask the local Ollama what it has actually pulled. */
  const loadLocalModels = useCallback(async () => {
    setLocalModelsLoading(true);
    setLocalModelsError(null);
    try {
      const res = await fetch(`${getChatApiBase()}/debug/local/models`);
      if (!res.ok) {
        let detail = `Failed to list local models: ${res.status}`;
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
      setLocalModels(Array.isArray(data.models) ? data.models : []);
    } catch (e: any) {
      setLocalModels([]);
      setLocalModelsError(e.message || 'Failed to list local models');
    } finally {
      setLocalModelsLoading(false);
      setLocalModelsFetched(true);
    }
  }, []);

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
      setCloudModelsFetched(true);
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
        // Only what this panel still edits. It used to also send the provider,
        // both model names and the preprocessing block — values it had merely
        // loaded and was echoing back, which meant saving a system prompt could
        // silently revert a model another browser had just switched to. Which
        // model answers is set by the header menu; the slice range is set per
        // message on the composer.
        body: JSON.stringify({
          system_prompt: systemPrompt,
          ollama_options: {
            think: ollamaThink,
            suffix: ollamaSuffix || null,
          },
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
    setIsSettingsOpen(true);
    loadSettings();
  }, [loadSettings]);

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
    const wantsList = isModelMenuOpen || isSettingsOpen;
    if (wantsList && cloudUsable && !cloudModelsFetched && !cloudModelsLoading) {
      loadCloudModels();
    }
  }, [
    isModelMenuOpen,
    isSettingsOpen,
    cloudUsable,
    cloudModelsFetched,
    cloudModelsLoading,
    loadCloudModels,
  ]);

  // Same, for the local catalogue. Cheap by comparison — one /api/tags against a
  // host on the same network — but still only when something is about to show it.
  useEffect(() => {
    const wantsList = isModelMenuOpen || isSettingsOpen;
    if (wantsList && !localModelsFetched && !localModelsLoading) {
      loadLocalModels();
    }
  }, [isModelMenuOpen, isSettingsOpen, localModelsFetched, localModelsLoading, loadLocalModels]);

  /**
   * The local models to show: what the server reports, plus whatever the
   * middleware is currently pointed at.
   *
   * The second half matters when the listing is empty or failed. Without it the
   * menu would have nothing to offer while a model is demonstrably in use, and
   * the panel would be unable to name the model answering the next message.
   */
  const localCatalogue = useMemo(() => {
    if (!ollamaModel || localModels.some(m => m.name === ollamaModel)) {
      return localModels;
    }
    return [
      ...localModels,
      { name: ollamaModel, capabilities: [] as string[], supports_vision: false },
    ];
  }, [localModels, ollamaModel]);

  /** A model in use but absent from the server's own listing. */
  const isUnlisted = useCallback(
    (name: string) => localModels.length > 0 && !localModels.some(m => m.name === name),
    [localModels]
  );

  const modelKey = (p: ProviderName, name: string) => `${p}:${name}`;

  /**
   * What a model can do with the images, in the menu's own words.
   *
   * "Text only" matters here in a way it would not in a general chat client: this
   * panel sends DICOM slices, so a model without vision answers from the
   * conversation and never sees the study.
   */
  const describeCapability = (m: CloudModelInfo, known: boolean) =>
    !known
      ? 'Capabilities unknown'
      : m.supports_vision
        ? 'Vision'
        : 'Text only — cannot see images';

  /** Whether a model may appear in the header menu. */
  const isModelEnabled = useCallback(
    (p: ProviderName, name: string) =>
      // An empty set means the user has not pruned the list yet, so everything
      // shows. Anything currently in effect always shows, whatever the setting,
      // so the menu can never hide the model it is about to use.
      enabledModelKeys.size === 0 ||
      enabledModelKeys.has(modelKey(p, name)) ||
      (p === provider && name === (p === 'cloud' ? cloudModel : ollamaModel)),
    [enabledModelKeys, provider, cloudModel, ollamaModel]
  );

  /** What the header menu actually offers, after the settings pruning. */
  const menuLocalModels = useMemo(
    () => localCatalogue.filter(m => isModelEnabled('local', m.name)),
    [localCatalogue, isModelEnabled]
  );
  const menuCloudModels = useMemo(
    () => visibleCloudModels.filter(m => isModelEnabled('cloud', m.name)),
    [visibleCloudModels, isModelEnabled]
  );

  const toggleModelEnabled = useCallback(
    (p: ProviderName, name: string) => {
      setEnabledModelKeys(prev => {
        // First tick materialises the implicit "everything" into a real set, so
        // unticking one model does not read as unticking all the others.
        const base =
          prev.size === 0
            ? new Set([
                ...localCatalogue.map(m => modelKey('local', m.name)),
                ...cloudModels.map(m => modelKey('cloud', m.name)),
              ])
            : prev;
        const next = new Set(base);
        const key = modelKey(p, name);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        try {
          localStorage.setItem(ENABLED_MODELS_KEY, JSON.stringify([...next]));
        } catch (_) {
          // Storage unavailable; the choice still applies for this session.
        }
        return next;
      });
    },
    [localCatalogue, cloudModels]
  );

  // Restore the pruned list. localStorage rather than session: which models a
  // department uses is a standing preference, not something to re-choose daily.
  useEffect(() => {
    try {
      const stored = localStorage.getItem(ENABLED_MODELS_KEY);
      const parsed = stored ? JSON.parse(stored) : null;
      if (Array.isArray(parsed)) {
        setEnabledModelKeys(new Set(parsed.filter((k): k is string => typeof k === 'string')));
      }
    } catch (_) {
      // Unreadable or corrupt: fall back to offering everything.
    }
  }, []);

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
   * Threads the user has deleted, so a late effect cannot bring one back.
   *
   * The persist effect below is passive: one scheduled by a token arriving
   * mid-stream can still be pending when the delete is clicked, and it captured
   * the thread as it was then. Running afterwards it would write that thread
   * back, and the deletion would appear to have been undone by nothing the user
   * did. A ref rather than state because the effect has to see it in the same
   * commit the click causes.
   *
   * Defence rather than a fixed reproduction: React 18 flushes pending passive
   * effects before a discrete event, so the window is narrow and no test here
   * reaches it. Two lines to close a race that would be invisible and infuriating
   * if it ever opened.
   */
  const deletedThreadIds = useRef<Set<string>>(new Set());

  /**
   * Persist the active conversation as messages arrive.
   *
   * Only once it has content: an untouched panel would otherwise litter the
   * history with empty "New chat" entries every time it mounts. Streaming
   * messages are written too, so a reload mid-answer keeps the partial turn
   * rather than losing the question with it.
   */
  useEffect(() => {
    if (messages.length === 0 || deletedThreadIds.current.has(activeThreadId)) {
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

  /**
   * Ask the middleware to forget a session.
   *
   * Deliberately quiet. The user asked to delete a conversation, and locally it
   * is deleted; a middleware they cannot reach is not something they can act on,
   * and a notification about it would only be alarming. A 404 is success by
   * another name — the session is gone, which is what was wanted.
   */
  const closeServerSession = useCallback(async (serverSessionId: string) => {
    try {
      const res = await fetch(
        `${getChatApiBase()}/debug/sessions/${encodeURIComponent(serverSessionId)}`,
        { method: 'DELETE' }
      );
      if (!res.ok && res.status !== 404) {
        console.warn(`Chat: could not close session ${serverSessionId}: ${res.status}`);
      }
    } catch (e) {
      console.warn(`Chat: could not close session ${serverSessionId}`, e);
    }
  }, []);

  const deleteThread = useCallback(
    async (threadId: string) => {
      // Read the session id BEFORE the thread goes: removing it first would
      // throw away the only handle to the conversation on the server.
      //
      // For the open thread the live socket's id wins. The persisted one trails
      // it by a render while a session is being established, and deleting a
      // stale id would leave the real session behind while reporting success.
      const thread = threads.find(t => t.id === threadId);
      const serverSessionId =
        threadId === activeThreadId
          ? (sessionId ?? thread?.serverSessionId)
          : thread?.serverSessionId;

      deletedThreadIds.current.add(threadId);
      setThreads(prev => saveThreads(removeThread(prev, threadId)));
      try {
        if (threadId === activeThreadId) {
          // Discard it on both sides: the stored thread, the displayed
          // transcript, and the middleware session backing it. This is what the
          // old "Clear conversation" menu item did; deleting the open
          // conversation from the history list is now the only way to ask for
          // it, so it has to do the whole job rather than leaving a session
          // alive on the server.
          clearHistory();
          // Move the socket off this session before asking the server to drop
          // it. Not a guarantee of ordering — the close and the DELETE travel on
          // separate connections, and nothing here waits for the middleware to
          // process the close — so the middleware retires a deleted session for
          // any handler still holding it rather than relying on this. It is
          // still the right order to ask in. A non-active thread has no socket
          // on it, so its delete goes straight out.
          await startNewChat();
        }
      } catch (e) {
        // Reconnecting failed. That is the panel's problem to report elsewhere,
        // and it must not cost the deletion: skipping the DELETE here would
        // abandon exactly the session this whole path exists to close.
        console.warn('Chat: could not start a new session after deleting one', e);
      } finally {
        // Local deletion has already happened and does not depend on this. A
        // middleware that is down must not leave a conversation the user deleted
        // sitting in their history.
        if (serverSessionId) {
          await closeServerSession(serverSessionId);
        }
      }
    },
    [threads, activeThreadId, sessionId, startNewChat, clearHistory, closeServerSession]
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
      const boundedGroup = Math.min(state.groupIndex, dimensionGroupCount(series.axis) - 1);
      return (
        bounded.start !== state.range.start ||
        bounded.end !== state.range.end ||
        boundedGroup !== state.groupIndex
      );
    });
    if (stale.length === 0) {
      return;
    }
    setSliceStateByDisplaySet(prev => {
      const next = { ...prev };
      stale.forEach(series => {
        // The axis, not the frame count: on a 4D series they differ by the number
        // of dimension groups, and a range seeded against 155 would select five
        // times the anatomy the user sees.
        const total = series.axis.sliceCount;
        const existing = prev[series.displaySetInstanceUID];
        // An existing range is clamped, not discarded: the user chose it, and the
        // nearest valid range is closer to their intent than a reset.
        //
        // A series the viewport is showing seeds from the slice on screen; any
        // other seeds from the middleware's configured band, because there is no
        // "current slice" for a series nobody is looking at.
        const followed =
          viewerSlice.displaySetInstanceUID === series.displaySetInstanceUID &&
          viewerSlice.sliceNumber !== null;
        const range = existing
          ? clampRange(existing.range, total)
          : followed
            ? rangeAroundSlice(viewerSlice.sliceNumber as number, total)
            : initialRange(total, sliceStrategy, numSlices, centralPercentage);
        // A new series opens on whichever dimension group the viewport is already
        // showing, so the panel describes the image the reader is looking at.
        //
        // Falling back to the first is defensible here in a way it is not when
        // following. A series being attached has no selection to preserve and
        // some group has to be chosen; whatever is chosen is then shown in the
        // selector beside it, so the reader can see it and change it. Following
        // makes a promise instead — that the message carries what is on screen —
        // and a default there would break it silently.
        const seeded =
          existing?.groupIndex ??
          (viewerSlice.displaySetInstanceUID === series.displaySetInstanceUID &&
          viewerSlice.dimensionGroupNumber !== null
            ? viewerSlice.dimensionGroupNumber - 1
            : 0);
        next[series.displaySetInstanceUID] = {
          range,
          // A followed range is three slices, so it sends all three rather than
          // sampling the configured count out of them.
          count: Math.max(
            1,
            Math.min(
              existing?.count ?? (followed ? rangeSize(range) : numSlices),
              rangeSize(range),
              MAX_SLICES_PER_SERIES
            )
          ),
          groupIndex: Math.min(Math.max(0, seeded), dimensionGroupCount(series.axis) - 1),
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
   * While following, attach whatever the viewport is showing.
   *
   * This makes "follows viewer" mean what it says. It also means images are
   * attached to a prompt without the user asking for each one — a deliberate
   * change from the panel's original rule that attaching is always explicit. The
   * protections that made that rule worth having are the ones that stay: the
   * moment anything is invested in the prompt the context pins, and every sent
   * message still carries an immutable snapshot of exactly what went with it.
   */
  useEffect(() => {
    if (contextMode !== 'following') {
      return;
    }
    const uid = viewerSlice.displaySetInstanceUID;
    // Only a series of the study the prompt targets, and only one the panel can
    // actually offer — a viewport showing an SR or a series from elsewhere must
    // not silently attach it.
    const known = uid && availableSeries.some(s => s.displaySetInstanceUID === uid);
    setSelectedDisplaySetUIDs(prev => {
      if (!known) {
        // Following nothing attachable: leave whatever is there rather than
        // clearing an attachment on a transient empty viewport.
        return prev;
      }
      if (prev.size === 1 && prev.has(uid as string)) {
        return prev;
      }
      return new Set([uid as string]);
    });
  }, [contextMode, viewerSlice.displaySetInstanceUID, availableSeries]);

  /**
   * While following, keep the range on the slice the viewer is showing.
   *
   * Only the followed series, and only while following: the moment the user
   * moves a handle, types, or pins, this stops and the range is theirs. Written
   * as a separate effect from the seeding one above so that "follow the viewer"
   * and "repair a stale range" stay independently readable.
   */
  useEffect(() => {
    if (contextMode !== 'following') {
      return;
    }
    const uid = viewerSlice.displaySetInstanceUID;
    const sliceNumber = viewerSlice.sliceNumber;
    if (!uid || sliceNumber === null) {
      return;
    }
    const series = attachedSeries.find(s => s.displaySetInstanceUID === uid);
    if (!series || !canAddressAxis(series.axis, series.numImageFrames)) {
      return;
    }
    const range = rangeAroundSlice(sliceNumber, series.axis.sliceCount);
    const groups = dimensionGroupCount(series.axis);
    // Which dimension group to follow, or null for "the viewer has not said".
    //
    // A one-group series has one answer, and 0 is it. On a series with more, an
    // unreported group is NOT taken to mean the first: `useViewerSlice` reports
    // it as unknown precisely so that it is not guessed, and a dynamic series
    // shown in a stack viewport reports no group at all, permanently. Guessing
    // there would have the panel claim to be following a reader who is looking
    // at temporal position 4 while it sends position 1 — the silent disagreement
    // between what the panel says and what it sends that this whole path exists
    // to prevent. Unknown keeps whatever group is already selected instead.
    const followedGroup =
      viewerSlice.dimensionGroupNumber !== null
        ? Math.min(viewerSlice.dimensionGroupNumber - 1, groups - 1)
        : groups === 1
          ? 0
          : null;
    setSliceStateByDisplaySet(prev => {
      const current = prev[uid];
      const groupIndex = followedGroup ?? current?.groupIndex ?? 0;
      // Compared field by field: this runs on every scroll step, and a fresh
      // object each time would re-render the panel once per slice.
      if (
        current &&
        current.range.start === range.start &&
        current.range.end === range.end &&
        current.groupIndex === groupIndex &&
        current.count === rangeSize(range)
      ) {
        return prev;
      }
      return { ...prev, [uid]: { range, count: rangeSize(range), groupIndex } };
    });
  }, [contextMode, viewerSlice, attachedSeries]);

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
          groupIndex: 0,
          instances: [] as string[],
        };
      }
      const range = clampRange(state.range, series.axis.sliceCount);
      // Clamped on read as well as on write: a display set can be replaced in
      // place with one that has fewer dimension groups.
      const groupIndex = Math.min(
        Math.max(0, state.groupIndex),
        dimensionGroupCount(series.axis) - 1
      );
      return {
        addressable,
        range,
        count: state.count,
        sampled: sampleSliceNumbers(range, state.count),
        groupIndex,
        instances: dimensionGroupInstances(series.axis, groupIndex),
      };
    },
    [sliceStateByDisplaySet]
  );

  /** Choose which dimension group of a 4D series the message sends. */
  const setSeriesGroup = useCallback(
    (series: ChatSeriesInfo, groupIndex: number) => {
      pinContext();
      setSliceStateByDisplaySet(prev => {
        const current = prev[series.displaySetInstanceUID];
        if (!current) {
          return prev;
        }
        const bounded = Math.min(Math.max(0, groupIndex), dimensionGroupCount(series.axis) - 1);
        return { ...prev, [series.displaySetInstanceUID]: { ...current, groupIndex: bounded } };
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
          // The dimension group is carried through: moving the range says nothing about
          // which dimension group the question is about.
          [series.displaySetInstanceUID]: {
            range: bounded,
            count,
            groupIndex: current?.groupIndex ?? 0,
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
   * group-and-slice pair. The groups of one slice are the same anatomy imaged at
   * different times, on the same pixel grid, so a fractional rectangle drawn on
   * one is valid on all of them — and a region that stopped applying the moment
   * the reader switched group would be a worse surprise than one that follows.
   * Which group actually got cropped is recorded in the message snapshot.
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

  /**
   * While the prompt follows the viewer, the region follows it too.
   *
   * A cornerstone annotation stays on the plane it was drawn on, so scrolling
   * left the rectangle behind on its own slice: invisible, and with nothing on
   * screen to grab, unmovable — while the chip went on naming a slice the range
   * had already scrolled past. Following is a promise that the message carries
   * what is on screen, and the region is part of what it carries.
   *
   * Only while following. Pinned, the region stays exactly where it was drawn:
   * that is what pinning is for, and the chip says which slice it belongs to.
   *
   * The rectangle keeps its shape and its in-plane position — only the slice
   * changes — so nothing about the crop needs recomputing, and the slice number
   * is taken from the panel's own reading rather than from the annotation.
   */
  useEffect(() => {
    if (contextMode !== 'following' || !chatRoi) {
      return;
    }
    const sliceNumber = viewerSlice.sliceNumber;
    if (
      sliceNumber === null ||
      sliceNumber === chatRoi.sliceNumber ||
      viewerSlice.displaySetInstanceUID !== chatRoi.displaySetInstanceUID
    ) {
      // A region on another series is not this viewport's to move.
      return;
    }
    // Cast because `cornerstoneViewportService` comes from the cornerstone
    // extension and is absent from OHIF's core `Services` type, the same reason
    // `useViewerSlice` takes the manager untyped.
    const viewport = (
      servicesManager?.services as any
    )?.cornerstoneViewportService?.getCornerstoneViewport?.(activeViewportId);
    if (!moveChatRoiToViewportSlice(chatRoi.annotationUID, viewport)) {
      // The slice number is deliberately left alone: it describes where the
      // rectangle IS, and claiming it moved when it did not is the one thing
      // this whole panel exists to prevent.
      return;
    }
    setChatRoi(prev =>
      prev && prev.annotationUID === chatRoi.annotationUID ? { ...prev, sliceNumber } : prev
    );
  }, [contextMode, chatRoi, viewerSlice, activeViewportId, servicesManager]);

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

  /** Total images the next message will carry, across every attached series. */
  const totalImagesToSend = useMemo(
    () =>
      attachedSeries.reduce((total, series) => {
        const { addressable, sampled } = sliceSelectionFor(series);
        // A series without slice addressing falls back to the configured recipe,
        // which the middleware clamps to the real volume depth.
        //
        // A region does not change the count: it crops the slices the range
        // selects, it does not select different ones. Narrowing to a single
        // cropped slice is the range slider's job.
        return total + (addressable ? sampled.length : Math.min(numSlices, series.numImageFrames));
      }, 0),
    [attachedSeries, sliceSelectionFor, numSlices]
  );

  /**
   * The window a message will be rendered with, or null for the auto fallback.
   *
   * Only the viewport's own series gets it: a window is a range of values in one
   * volume's units, and applying a breast-MRI window to a CT would be worse than
   * having none. In practice the attached series IS the viewport's, but that is
   * a consequence of following, not a guarantee.
   */
  const windowFor = useCallback(
    (series: ChatSeriesInfo) => {
      if (!useViewerWindow || !viewerSlice.voi) {
        return null;
      }
      return viewerSlice.displaySetInstanceUID === series.displaySetInstanceUID
        ? viewerSlice.voi
        : null;
    },
    [useViewerWindow, viewerSlice]
  );

  /** What the collapsed section says, so folding it hides controls and not facts. */
  const contextSummary = useMemo(
    () =>
      formatContextSummary({
        studyLabel: promptStudyLabel,
        seriesDescriptions: attachedSeries.map(s => s.SeriesDescription),
        imageCount: totalImagesToSend,
        hasRegion: Boolean(chatRoi),
      }),
    [promptStudyLabel, attachedSeries, totalImagesToSend, chatRoi]
  );

  // Remember whether the section was folded, for the length of the session. A
  // reader who folds it is telling the panel their screen is short; re-opening it
  // on every remount would be answering that with "no".
  useEffect(() => {
    try {
      setIsContextCollapsed(sessionStorage.getItem(CONTEXT_COLLAPSED_KEY) === 'true');
    } catch (_) {
      // Storage can be unavailable (private mode, blocked cookies). Defaulting to
      // open is the safe answer: it shows more, never less.
    }
  }, []);

  useEffect(() => {
    try {
      // Only an explicit "false" turns it off; an unreadable or absent value
      // leaves the reader's window in force, which is the safer default.
      setUseViewerWindow(sessionStorage.getItem(USE_VIEWER_WINDOW_KEY) !== 'false');
    } catch (_) {
      // Storage unavailable; the default stands.
    }
  }, []);

  const toggleViewerWindow = useCallback(() => {
    setUseViewerWindow(current => {
      const next = !current;
      try {
        sessionStorage.setItem(USE_VIEWER_WINDOW_KEY, String(next));
      } catch (_) {
        // Not being able to remember the choice must not prevent making it.
      }
      return next;
    });
  }, []);

  const toggleContextCollapsed = useCallback(() => {
    setIsContextCollapsed(collapsed => {
      const next = !collapsed;
      try {
        sessionStorage.setItem(CONTEXT_COLLAPSED_KEY, String(next));
      } catch (_) {
        // Not being able to remember the choice must not prevent making it.
      }
      return next;
    });
  }, []);

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
      const {
        addressable,
        range,
        groupIndex,
        instances,
        sampled: sent,
      } = sliceSelectionFor(series);
      const roi = roiForSeries(series);
      const voi = windowFor(series);
      const entry: SnapshotSeries = {
        displaySetInstanceUID: series.displaySetInstanceUID,
        seriesInstanceUID: series.SeriesInstanceUID,
        description: series.SeriesDescription,
        modality: series.Modality,
        numFrames: series.numImageFrames,
        // Recorded whichever way it went: "auto" is a fact about these images
        // too, and a reader checking an old answer needs to know the window was
        // not theirs.
        ...(voi ? { voi: { ...voi } } : {}),
      };

      // The region crops every slice this series sends, whichever way the slices
      // were chosen. Recorded on the snapshot either way: a cropped image answers
      // a different question from a whole slice, and scrolling back must show
      // which one was asked.
      if (roi) {
        entry.roi = { ...roi.rect, sliceNumber: roi.sliceNumber, scope: 'range' };
      }

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
        if (dimensionGroupCount(series.axis) > 1) {
          entry.dimensionGroupNumber = groupIndex + 1;
          entry.dimensionGroupCount = dimensionGroupCount(series.axis);
          // The tag travels with them: it is what says whether this group is a
          // temporal position, a b-value or an echo, and a footer read back next
          // week cannot recover it from anywhere else.
          entry.splittingTag = series.axis.splittingTag;
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
          voi: voi ? { ...voi } : undefined,
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
        sliceSelections.push({
          series_uid: series.SeriesInstanceUID,
          sop_instance_uids: [],
          num_slices: sliceRecipe.numSlices,
          slice_strategy: sliceRecipe.strategy,
          central_percentage: sliceRecipe.centralPercentage,
          roi: roi ? { ...roi.rect } : undefined,
          // The window applies however the middleware ends up choosing slices.
          voi: voi ? { ...voi } : undefined,
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
    roiForSeries,
    windowFor,
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
          {/* Whatever is known comes first. A loading or error state is only
              worth the space when there is nothing to show behind it — the model
              in use is always in this list, and hiding it behind "Loading…"
              would leave the menu unable to name the model answering the next
              message. */}
          {menuLocalModels.length === 0 ? (
            localModelsLoading ? (
              <div className="text-muted-foreground px-3 py-2 text-xs">Loading models…</div>
            ) : localModelsError ? (
              <div className="px-3 py-2 text-[11px] text-red-300">{localModelsError}</div>
            ) : (
              <div className="text-muted-foreground px-3 py-2 text-xs">
                {localCatalogue.length === 0
                  ? 'No models pulled on the local server'
                  : 'None enabled — see Settings'}
              </div>
            )
          ) : (
            menuLocalModels.map(m => (
              <button
                key={m.name}
                type="button"
                role="option"
                aria-selected={provider === 'local' && ollamaModel === m.name}
                onClick={() => applyModelSelection('local', m.name)}
                className="hover:bg-accent block w-full px-3 py-2 text-left"
              >
                <div className="text-foreground truncate text-xs">{m.name}</div>
                <div className="text-muted-foreground text-[11px]">
                  {isUnlisted(m.name) ? 'Not listed by the server' : describeCapability(m, true)}
                  {provider === 'local' && ollamaModel === m.name ? ' · in use' : ''}
                </div>
              </button>
            ))
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
          ) : cloudModelsLoading && menuCloudModels.length === 0 ? (
            <div className="text-muted-foreground px-3 py-2 text-xs">Loading models…</div>
          ) : cloudModelsError && menuCloudModels.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-red-300">{cloudModelsError}</div>
          ) : (
            <>
              {/* Where the images go. Stated as provenance, not as a warning:
                  enabling the cloud backend is an operator decision, and the
                  reader only needs to know which host answers. */}
              <div className="text-muted-foreground px-3 pb-1 text-[11px]">
                via {cloudUrl || 'the cloud provider'}
              </div>
              {menuCloudModels.length === 0 ? (
                <div className="text-muted-foreground px-3 py-2 text-xs">
                  {cloudModels.length === 0 ? 'No models offered' : 'None enabled — see Settings'}
                </div>
              ) : (
                menuCloudModels.map(m => (
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
                      {describeCapability(m, cloudCapabilitiesKnown)}
                      {provider === 'cloud' && cloudModel === m.name ? ' · in use' : ''}
                    </div>
                  </button>
                ))
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
                    onClick={() => void deleteThread(t.id)}
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

  // Settings opens directly from the header. It used to sit behind an overflow
  // menu alongside "Clear conversation" and the session UUID; with those gone the
  // menu held one item, which is a menu that exists to be dismissed. A
  // conversation is still discarded from the history list, where the rest of the
  // per-conversation actions already live.
  const renderSettingsButton = () => (
    <Button
      variant="ghost"
      size="icon"
      onClick={openSettings}
      title="Settings"
      aria-label="Settings"
    >
      <Icons.GearSettings className="h-5 w-5" />
    </Button>
  );

  const renderHeader = () => (
    <div className="border-input relative flex items-center justify-between gap-2 border-b px-3 py-2">
      <span className="text-foreground truncate text-sm font-semibold">AI Assistant</span>
      <div className="flex flex-shrink-0 items-center gap-1">
        {renderModelMenu()}
        {renderHistoryMenu()}
        {renderSettingsButton()}
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
      <div className="flex items-center justify-between gap-2">
        {/* The heading is the collapse control. The section is the tallest thing
            in the panel and pushes the conversation off screen on a short
            viewport, so it folds — but see `contextSummary`: what a message will
            carry stays on screen either way. */}
        <button
          type="button"
          onClick={toggleContextCollapsed}
          aria-expanded={!isContextCollapsed}
          aria-controls="chat-prompt-context"
          title={isContextCollapsed ? 'Show prompt context' : 'Hide prompt context'}
          className="text-muted-foreground hover:text-foreground flex min-w-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-wide"
        >
          <span aria-hidden="true">{isContextCollapsed ? '▸' : '▾'}</span>
          Prompt context
        </button>
        <button
          type="button"
          onClick={() => setContextMode(m => (m === 'following' ? 'pinned' : 'following'))}
          title={
            contextMode === 'following'
              ? 'Study, series and slice follow the main window. Click to freeze what will be sent.'
              : 'Frozen: the main window no longer changes what will be sent. Click to follow it again.'
          }
          className="text-muted-foreground hover:text-foreground flex flex-shrink-0 items-center gap-1 text-[11px]"
        >
          <span
            aria-hidden="true"
            className={`h-1.5 w-1.5 rounded-full ${contextMode === 'following' ? 'bg-highlight' : 'bg-muted-foreground'}`}
          />
          {/* Named for everything it governs. It now really does track the main
              window — study, series and slice — so the label must not scope
              itself to the study the way it did when that was all it did. */}
          {contextMode === 'following' ? 'Follows viewer' : 'Pinned'}
        </button>
      </div>

      {/* Collapsed, the section still states what the next message will send.
          Clicking it opens the section, so the summary is also the way back. */}
      {isContextCollapsed && promptStudyUID && (
        <button
          type="button"
          onClick={toggleContextCollapsed}
          title="Show prompt context"
          className="text-foreground hover:text-foreground/80 mt-1 block w-full truncate text-left text-xs"
        >
          {contextSummary}
        </button>
      )}

      {/* The prompt and the viewport point at different studies. This is a
          correctness warning about the message about to be sent, so it shows
          whether the section is open or folded. */}
      {viewerHasDiverged && (
        <div className="bg-amber-950/40 mb-2 mt-2 rounded border border-amber-600 px-2 py-1.5 text-[11px] text-amber-200">
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

      {isContextCollapsed ? null : promptStudyUID ? (
        <div id="chat-prompt-context">
          <div className="text-foreground mb-1.5 mt-2 truncate text-xs">{promptStudyLabel}</div>

          {/* One block per attached series: the chip that identifies it, then the
              range control that says what it will send. Per series because ranges
              are not comparable across acquisitions of different depth. */}
          {attachedSeries.map(series => {
            const { addressable, range, count, sampled, groupIndex } = sliceSelectionFor(series);
            const seriesRoi = roiForSeries(series);
            const groups = dimensionGroupCount(series.axis);
            const onThisSeries = viewerSlice.displaySetInstanceUID === series.displaySetInstanceUID;
            // Which dimension group the viewport is on, when it is on this series at all.
            // Only ever an offer — adopting it automatically would let scrolling
            // rewrite the question mid-compose.
            const viewerGroupIndex =
              onThisSeries && viewerSlice.dimensionGroupNumber !== null
                ? viewerSlice.dimensionGroupNumber - 1
                : null;
            // What one group of this series is called, from the tag it was split
            // on rather than from what this deployment usually sees.
            const noun = groupNoun(series.axis.splittingTag);
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

                {/* Which position on the fourth axis the question is about. Only
                    for a series that has more than one: on a dynamic study it
                    decides what the images mean, and leaving it implicit is how
                    five slices from five different contrast phases got sent as
                    though they were one acquisition.

                    Named from the tag cornerstone split on, so a diffusion series
                    reads "b-value 2 of 4" rather than calling a b-value a phase. */}
                {addressable && groups > 1 && (
                  <div className="text-muted-foreground mt-1 flex items-center gap-1 text-[11px]">
                    <label
                      htmlFor={`dimension-group-${series.displaySetInstanceUID}`}
                      className="first-letter:uppercase"
                    >
                      {noun}
                    </label>
                    <select
                      id={`dimension-group-${series.displaySetInstanceUID}`}
                      aria-label={`${noun} for ${series.SeriesDescription}`}
                      className="border-input bg-background text-foreground rounded border px-1 py-0.5"
                      value={groupIndex}
                      onChange={e => setSeriesGroup(series, Number(e.target.value))}
                    >
                      {Array.from({ length: groups }, (_, i) => (
                        <option
                          key={i}
                          value={i}
                        >
                          {i + 1} of {groups}
                        </option>
                      ))}
                    </select>
                    {viewerGroupIndex !== null && viewerGroupIndex !== groupIndex && (
                      <button
                        type="button"
                        onClick={() => setSeriesGroup(series, viewerGroupIndex)}
                        className="text-primary underline"
                        title={`The viewport is showing ${noun} ${viewerGroupIndex + 1}`}
                      >
                        use {noun} {viewerGroupIndex + 1}
                      </button>
                    )}
                    {/* Said plainly rather than left to look like the viewer's
                        choice. A series has to open on some group, and while
                        following, a reader who is told the prompt tracks the
                        viewport would otherwise read this one as tracked. A
                        stack viewport of a dynamic series reports no group at
                        all, so this is not a flicker during load — it can be the
                        permanent state. */}
                    {onThisSeries && viewerGroupIndex === null && (
                      <span title="The viewport is not reporting which one it is showing">
                        (not the viewer’s)
                      </span>
                    )}
                  </div>
                )}

                {/* The window these images will be rendered with. Shown per
                    series because it is per series that it applies, and stated
                    even when it is the fallback: "auto" is a fact about what the
                    model will see, not an absence of one. */}
                <div className="text-muted-foreground mt-1 flex items-center gap-1 text-[11px]">
                  <label className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={useViewerWindow}
                      onChange={toggleViewerWindow}
                      aria-label="Render with the viewer's window"
                      className="accent-primary"
                    />
                    Viewer window
                  </label>
                  <span className="truncate">
                    {windowFor(series)
                      ? formatWindow(
                          windowFor(series) as { lower: number; upper: number; invert: boolean }
                        )
                      : useViewerWindow
                        ? '— unavailable, auto-windowed'
                        : '— off, auto-windowed'}
                  </span>
                </div>

                {addressable && range ? (
                  <SliceRangeSlider
                    total={series.axis.sliceCount}
                    range={range}
                    count={count}
                    // Only when the viewport is showing THIS series: a slice
                    // number from another acquisition would point at a position
                    // that means nothing here. The marker follows the anatomy
                    // across groups, because anatomy is the axis the slider is.
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

                {/* The region, and how far it reaches. Directly under the range,
                    because the range is what decides how many slices it crops:
                    a region on one slice alone is a range of one. */}
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
                    {/* Said rather than implied. The rectangle sits on one slice,
                        so "it crops all of them" is the surprising half, and the
                        drag hint is the only place the panel can mention a
                        gesture that happens on the image and not in here. */}
                    <span className="text-muted-foreground">
                      Crops every slice sent · drag it on the image to move it
                    </span>
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
          </div>

          {roiError && <div className="mb-1 text-[11px] text-amber-300">{roiError}</div>}

          {/* The one number that matters across the whole prompt: how many images
              this message will carry. */}
          <div className="text-muted-foreground text-[11px]">
            {attachedSeries.length > 0 ? (
              `Sends ${totalImagesToSend} image${totalImagesToSend === 1 ? '' : 's'} in total`
            ) : contextMode === 'pinned' ? (
              // Detaching is the only way to get here, and with the series picker
              // gone the follow toggle is the only way back. A dead end would be
              // worse than a sentence.
              <>
                No series attached — the model will answer from the conversation only. Switch to{' '}
                <button
                  type="button"
                  onClick={() => setContextMode('following')}
                  className="text-primary underline"
                >
                  Follows viewer
                </button>{' '}
                to send what is on screen.
              </>
            ) : (
              'No series attached — the model will answer from the conversation only.'
            )}
          </div>
        </div>
      ) : (
        <div className="text-muted-foreground mt-2 text-xs">No study open in the viewer.</div>
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

            {/* Which models the chat may offer */}
            <div className="border-input border-t pt-4">
              <div className="mb-1 flex items-center justify-between">
                <h4 className="text-foreground text-xs font-semibold">Models available in chat</h4>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    loadLocalModels();
                    if (cloudUsable) {
                      loadCloudModels();
                    }
                  }}
                  disabled={localModelsLoading || cloudModelsLoading}
                  aria-label="Refresh model list"
                >
                  {localModelsLoading || cloudModelsLoading ? 'Loading…' : 'Refresh'}
                </Button>
              </div>
              <p className="text-muted-foreground mb-3 text-xs">
                Tick the models the model menu should offer. Which one answers a given message is
                chosen there, next to the chat.
              </p>

              {/* Local */}
              <div className="text-muted-foreground mb-1 text-[11px] font-semibold uppercase">
                Local
              </div>
              {localModelsError ? (
                <div className="mb-3 rounded border border-red-700 bg-red-900/50 px-3 py-2 text-xs text-red-300">
                  {localModelsError}
                </div>
              ) : localCatalogue.length === 0 ? (
                <p className="text-muted-foreground mb-3 text-xs">
                  {localModelsLoading
                    ? 'Loading…'
                    : 'The local server has no models pulled. An operator adds one with `ollama pull`.'}
                </p>
              ) : (
                <div className="mb-3 space-y-1">
                  {localCatalogue.map(m => (
                    <label
                      key={m.name}
                      className="text-foreground flex items-start gap-2 text-xs"
                    >
                      <input
                        type="checkbox"
                        checked={isModelEnabled('local', m.name)}
                        onChange={() => toggleModelEnabled('local', m.name)}
                        aria-label={`Offer ${m.name}`}
                        className="accent-primary mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="block truncate">{m.name}</span>
                        <span className="text-muted-foreground block text-[11px]">
                          {isUnlisted(m.name)
                            ? 'In use, but not listed by the server'
                            : describeCapability(m, true)}
                        </span>
                      </span>
                    </label>
                  ))}
                </div>
              )}

              {/* Cloud */}
              <div className="text-muted-foreground mb-1 text-[11px] font-semibold uppercase">
                Ollama Cloud
              </div>
              {!cloudEnabled ? (
                <p className="text-muted-foreground text-xs">
                  Disabled on this deployment. An operator must set{' '}
                  <code>ALLOW_CLOUD_BACKEND=1</code> on the chat-middleware service.
                </p>
              ) : !cloudConfigured ? (
                <p className="text-muted-foreground text-xs">
                  No API key is configured on the chat-middleware service. An operator must set{' '}
                  <code>OLLAMA_API_KEY</code>.
                </p>
              ) : cloudModelsError ? (
                <div className="rounded border border-red-700 bg-red-900/50 px-3 py-2 text-xs text-red-300">
                  {cloudModelsError}
                </div>
              ) : (
                <>
                  <p className="text-muted-foreground mb-2 text-[11px]">
                    Answered by {cloudUrl || 'the cloud provider'}.
                  </p>
                  <div className="space-y-1">
                    {visibleCloudModels.map(m => (
                      <label
                        key={m.name}
                        className="text-foreground flex items-start gap-2 text-xs"
                      >
                        <input
                          type="checkbox"
                          checked={isModelEnabled('cloud', m.name)}
                          onChange={() => toggleModelEnabled('cloud', m.name)}
                          aria-label={`Offer ${m.name}`}
                          className="accent-primary mt-0.5"
                        />
                        <span className="min-w-0">
                          <span className="block truncate">{m.name}</span>
                          <span className="text-muted-foreground block text-[11px]">
                            {describeCapability(m, cloudCapabilitiesKnown)}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>

                  {/* Text-only models are hidden by default rather than merely
                      flagged: alphabetically the catalogue leads with several
                      that cannot see the study. */}
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
                </>
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
                {/* No longer "attach series below": the series on screen is
                    already attached, and there is nothing to attach it with. */}
                <div className="text-center text-xs">
                  Ask about the series you are viewing — what it will send is summarised below.
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
          </div>
        </div>
      </div>
    </div>
  );
};

export default ChatPanel;
