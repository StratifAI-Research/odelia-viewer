import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useSystem, utils } from '@ohif/core';
import { useImageViewer, useUserAuthentication } from '@ohif/ui';
import { useViewportGrid } from '@ohif/ui-next';
import { FooterAction } from '@ohif/ui-next';
import { useActiveStudyUID } from '../../hooks/useActiveStudyUID';
import { resultTsFromDisplaySet } from '../../utils/dicomDateTime';

/**
 * Mock Feedback Panel – allows radiologists to mark Agree / Unsure / Disagree per breast side.
 * This is a first-cut prototype for stakeholder review.
 */
const OPTIONS: Array<'Agree' | 'Unsure' | 'Disagree'> = ['Agree', 'Unsure', 'Disagree'];
const VERDICT_TO_INT: Record<'Agree' | 'Unsure' | 'Disagree', number> = {
  Agree: 1,
  Unsure: 0,
  Disagree: -1,
};
const INT_TO_VERDICT: Record<number, 'Agree' | 'Unsure' | 'Disagree'> = {
  1: 'Agree',
  0: 'Unsure',
  [-1]: 'Disagree',
} as any;

// Local storage key for simple, quick user identification
const LOCAL_USER_KEY = 'ohif.aiFeedback.displayName';

// Derive Orthanc base path from app-config data source (qidoRoot like '/pacs/dicom-web').
function deriveFeedbackApiBase(): string {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cfg: any = (window as any)?.config;
    const dataSources = cfg?.dataSources || [];
    const dw = dataSources.find((ds: any) => ds?.configuration?.qidoRoot);
    const qidoRoot: string | undefined = dw?.configuration?.qidoRoot;
    if (qidoRoot && typeof qidoRoot === 'string') {
      const idx = qidoRoot.indexOf('/dicom-web');
      if (idx > 0) {
        return qidoRoot.slice(0, idx);
      }
      // if qidoRoot equals '/dicom-web', Orthanc is at root
      if (qidoRoot === '/dicom-web') return '';
      // otherwise use dirname as base
      const parts = qidoRoot.split('/').filter(Boolean);
      if (parts.length > 0) return `/${parts[0]}`;
    }
  } catch (_) {
    // ignore
  }
  // Fallback to same-origin root
  return '';
}

const FEEDBACK_API_BASE = deriveFeedbackApiBase();

const FeedbackPanel: React.FC = () => {
  // Access OHIF services
  const { servicesManager } = useSystem();
  const { StudyInstanceUIDs } = useImageViewer();
  const [authState] = useUserAuthentication();
  const [{ activeViewportId, viewports }, viewportGridService] = useViewportGrid();
  const aiResultsService: any = servicesManager.services?.aiResultsService;
  const userAuthenticationService: any = servicesManager.services?.userAuthenticationService;
  const displaySetService: any = servicesManager.services?.displaySetService;

  // --- Local component state ---
  const [activeStudyUID, setActiveStudyUID] = useState<string | null>(null);
  const [aiMeta, setAiMeta] = useState<any[]>([]); // dropdown list
  const [selectedUID, setSelectedUID] = useState<string>('');
  const [currentResult, setCurrentResult] = useState<any | null>(null);
  const [feedback, setFeedback] = useState<Record<'Left' | 'Right', string | null>>({
    Left: null,
    Right: null,
  });
  const [locked, setLocked] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitMessage, setSubmitMessage] = useState<string>('');
  const [hasFeedbackByUID, setHasFeedbackByUID] = useState<Record<string, boolean>>({});
  const [isEditMode, setIsEditMode] = useState<boolean>(false);
  const [userDisplayName, setUserDisplayName] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState<string>('');

  // Extract a stable user identifier from authentication service response
  const extractUserIdFromAuth = useCallback((svcUser: any): string | null => {
    try {
      const profile = svcUser?.profile || {};
      const candidates = [
        profile?.preferred_username,
        profile?.email,
        profile?.sub,
        svcUser?.preferred_username,
        svcUser?.email,
        svcUser?.sub,
        svcUser?.name,
        svcUser?.id,
      ];
      for (const candidate of candidates) {
        if (candidate && String(candidate).trim().length > 0) return String(candidate).trim();
      }
    } catch (_) {
      // ignore
    }
    return null;
  }, []);

  // Helper to extract study UID from the active viewport
  const getStudyUIDFromActiveViewport = useActiveStudyUID({
    activeViewportId,
    viewports,
    displaySetService,
    StudyInstanceUIDs,
  });

  // Helper to refresh dropdown list & selection info
  const refreshMeta = useCallback(() => {
    if (!aiResultsService || !activeStudyUID) return;
    const meta = aiResultsService.getAIResultMetadata?.(activeStudyUID, servicesManager) || [];
    setAiMeta(meta);
    const selected = meta.find((m: any) => m.isSelected);
    if (selected) {
      setSelectedUID(selected.displaySetInstanceUID);
      return;
    }
    // If nothing is selected yet, auto-select the first AI result
    if (meta.length > 0) {
      const firstUID = meta[0].displaySetInstanceUID;
      setSelectedUID(firstUID);
      aiResultsService.setSelectedAIResult?.(activeStudyUID, firstUID, servicesManager);
    }
  }, [aiResultsService, activeStudyUID, servicesManager]);

  // Helper to refresh the currently displayed AI result
  const refreshCurrent = useCallback(() => {
    if (!aiResultsService || !activeStudyUID) return;
    const res = aiResultsService.getSelectedAIResult?.(activeStudyUID, servicesManager);
    if (res) {
      setCurrentResult(res);
    }
  }, [aiResultsService, activeStudyUID, servicesManager]);

  // --- User identity handling ---
  const deriveUserId = useCallback((): string | null => {
    try {
      const svcUser = authState?.user ?? userAuthenticationService?.getUser?.();
      const authId = extractUserIdFromAuth(svcUser);
      if (authId) return authId;
    } catch (_) {
      // ignore
    }
    if (userDisplayName && userDisplayName.trim().length > 0) return userDisplayName.trim();
    try {
      const stored = window.localStorage.getItem(LOCAL_USER_KEY);
      if (stored && stored.trim().length > 0) return stored.trim();
    } catch (_) {
      // ignore storage errors
    }
    return null;
  }, [authState, extractUserIdFromAuth, userAuthenticationService, userDisplayName]);

  const userId: string | null = deriveUserId();

  const ensureUserInitialized = useCallback(() => {
    try {
      const svcUser = userAuthenticationService?.getUser?.();
      const authId = extractUserIdFromAuth(svcUser);
      if (authId) {
        setUserDisplayName(String(authId));
        return;
      }
      const stored = window.localStorage.getItem(LOCAL_USER_KEY);
      if (stored && stored.trim().length > 0) {
        setUserDisplayName(stored.trim());
        // also reflect into auth service for consistency
        userAuthenticationService?.setUser?.({ id: stored.trim(), name: stored.trim(), source: 'local' });
      }
    } catch (_) {
      // ignore
    }
  }, [extractUserIdFromAuth, userAuthenticationService]);

  useEffect(() => {
    ensureUserInitialized();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Initialize activeStudyUID on mount
  useEffect(() => {
    if (!activeStudyUID) {
      const initialStudyUID = getStudyUIDFromActiveViewport();
      if (initialStudyUID) {
        setActiveStudyUID(initialStudyUID);
      }
    }
  }, [activeStudyUID, getStudyUIDFromActiveViewport]);

  // Track viewport changes and update activeStudyUID
  useEffect(() => {
    const studyUID = getStudyUIDFromActiveViewport();
    if (studyUID && studyUID !== activeStudyUID) {
      console.log(`FeedbackPanel: Study changed from ${activeStudyUID} to ${studyUID}`);
      setActiveStudyUID(studyUID);
      // Reset feedback state when study changes
      setFeedback({ Left: null, Right: null });
      setLocked(false);
      setIsEditMode(false);
      setSubmitMessage('');
      // Note: checkSubmissionStatus will automatically refetch from backend via its useEffect
    }
  }, [activeViewportId, viewports, getStudyUIDFromActiveViewport, activeStudyUID]);

  // Helpers to read identity fields from currentResult
  const modelName: string | undefined = useMemo(() => {
    // Prefer SR-parsed model info name
    return (
      currentResult?.modelInfo?.name ||
      currentResult?.modelName ||
      currentResult?.model?.name ||
      undefined
    );
  }, [currentResult]);

  const modelVersion: string | undefined = useMemo(() => {
    // Map to algorithmVersion from SR if available
    return (
      currentResult?.modelInfo?.algorithmVersion ||
      currentResult?.modelVersion ||
      currentResult?.model?.version ||
      undefined
    );
  }, [currentResult]);

  const resultTs: string | undefined = useMemo(() => {
    // Prefer AIResultsService-provided timestamp
    const r = currentResult || {};
    const direct = r.resultTs || r.result_ts || r.resultTimestamp || r.createdAt || r.timestamp;
    if (typeof direct === 'string' && direct.length > 0) return direct;
    // Derive from the selected SR display set creation date/time
    try {
      const dss = servicesManager?.services?.displaySetService;
      const sr = selectedUID ? dss?.getDisplaySetByUID(selectedUID) : null;
      return resultTsFromDisplaySet(sr);
    } catch (_) {
      return undefined;
    }
  }, [currentResult, selectedUID, servicesManager]);

  // Initial load
  useEffect(() => {
    refreshMeta();
    refreshCurrent();
  }, [refreshMeta, refreshCurrent]);

  // Subscribe to global selection changes so panel stays in sync
  useEffect(() => {
    if (!aiResultsService) return;
    const { unsubscribe } = aiResultsService.subscribe(
      aiResultsService.EVENTS.AI_RESULT_SELECTED,
      () => {
        refreshMeta();
        refreshCurrent();
      }
    );
    return () => unsubscribe();
  }, [aiResultsService, refreshMeta, refreshCurrent]);

  // Check if this user has already submitted for the selected AI result
  const canQueryBackend = Boolean(
    activeStudyUID && modelName && modelVersion && resultTs
  );

  const checkSubmissionStatus = useCallback(async () => {
    if (!canQueryBackend) {
      setLocked(false);
      return;
    }
    if (!userId) {
      setLocked(false);
      return;
    }
    try {
      const params = new URLSearchParams({
        study_uid: String(activeStudyUID),
        model_name: String(modelName),
        model_version: String(modelVersion),
        result_ts: String(resultTs),
        includeUsers: 'true',
      });
      const res = await fetch(`${FEEDBACK_API_BASE}/feedback?${params.toString()}`);
      if (!res.ok) return;
      const data = await res.json();
      // Lock if current user already submitted; also prefill selections
      const u = Array.isArray(data.users) ? data.users.find((x: any) => x.user_id === userId) : null;
      if (u) {
        setLocked(true);
        const left = INT_TO_VERDICT[Number(u.verdict_L) as 1 | 0 | -1];
        const right = INT_TO_VERDICT[Number(u.verdict_R) as 1 | 0 | -1];
        setFeedback({ Left: left, Right: right });
      } else {
        setLocked(false);
      }
    } catch (e) {
      // swallow; keep UI functional
    }
  }, [activeStudyUID, modelName, modelVersion, resultTs, canQueryBackend, userId]);

  useEffect(() => {
    checkSubmissionStatus();
  }, [selectedUID, modelName, modelVersion, resultTs, activeStudyUID, checkSubmissionStatus]);

  // Compute markers for dropdown: whether current user has submitted feedback per AI result
  useEffect(() => {
    let aborted = false;
    (async () => {
      if (!aiMeta?.length || !activeStudyUID || !userId) {
        setHasFeedbackByUID({});
        return;
      }
      const entries = await Promise.all(
        aiMeta.map(async (m: any) => {
          try {
            const res = aiResultsService.getAIResultByDisplaySet?.(
              activeStudyUID,
              m.displaySetInstanceUID,
              servicesManager
            );
            const r = res || {};
            const name = r?.modelInfo?.name || null;
            const version = r?.modelInfo?.algorithmVersion || null;
            const ts = r?.resultTs || (() => {
              // Fallback: derive from display set
              try {
                const dss = servicesManager?.services?.displaySetService;
                const ds = dss?.getDisplaySetByUID(m.displaySetInstanceUID);
                return resultTsFromDisplaySet(ds);
              } catch (_) {
                return undefined;
              }
            })();
            if (!name || !version || !ts) return [m.displaySetInstanceUID, false] as const;
            const params = new URLSearchParams({
              study_uid: String(activeStudyUID),
              model_name: String(name),
              model_version: String(version),
              result_ts: String(ts),
              includeUsers: 'true',
            });
            const resp = await fetch(`${FEEDBACK_API_BASE}/feedback?${params.toString()}`);
            if (!resp.ok) return [m.displaySetInstanceUID, false] as const;
            const data = await resp.json();
            const u = Array.isArray(data.users) ? data.users.find((x: any) => x.user_id === userId) : null;
            return [m.displaySetInstanceUID, Boolean(u)] as const;
          } catch (_) {
            return [m.displaySetInstanceUID, false] as const;
          }
        })
      );
      if (aborted) return;
      const map: Record<string, boolean> = {};
      for (const [uid, has] of entries) {
        map[uid] = has;
      }
      setHasFeedbackByUID(map);
    })();
    return () => {
      aborted = true;
    };
  }, [aiMeta, activeStudyUID, aiResultsService, servicesManager, userId]);

  // Compute user markers only when a user is present
  useEffect(() => {
    if (!userId) {
      setHasFeedbackByUID(prev => {
        const empty: Record<string, boolean> = {};
        return empty;
      });
    }
  }, [userId]);

  // --- Interaction handlers ---
  const handleDropdownChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const uid = e.target.value;
    setSelectedUID(uid);
    if (aiResultsService && activeStudyUID) {
      aiResultsService.setSelectedAIResult(activeStudyUID, uid, servicesManager);
    }
  };

  const handlePrevNext = (direction: -1 | 1) => {
    if (!aiMeta.length) return;
    const index = aiMeta.findIndex(m => m.displaySetInstanceUID === selectedUID);
    if (index === -1) return;
    let nextIndex = index + direction;
    if (nextIndex < 0) nextIndex = aiMeta.length - 1;
    if (nextIndex >= aiMeta.length) nextIndex = 0;
    const nextUID = aiMeta[nextIndex].displaySetInstanceUID;
    aiResultsService.setSelectedAIResult(activeStudyUID, nextUID, servicesManager);
  };

  const setFeedbackValue = (side: 'Left' | 'Right', value: string) => {
    setFeedback(prev => ({ ...prev, [side]: value }));
  };

  const bothSidesChosen = Boolean(feedback.Left && feedback.Right);

  const handleSubmit = async () => {
    setSubmitMessage('');
    if (!bothSidesChosen || !canQueryBackend || !userId) return;
    setIsSubmitting(true);
    try {
      const { uiNotificationService } = servicesManager.services || {};
      const payload = {
        study_uid: activeStudyUID,
        model_name: modelName,
        model_version: modelVersion,
        result_ts: resultTs,
        user_id: userId,
        verdict_L: VERDICT_TO_INT[feedback.Left as 'Agree' | 'Unsure' | 'Disagree'],
        verdict_R: VERDICT_TO_INT[feedback.Right as 'Agree' | 'Unsure' | 'Disagree'],
        edited: isEditMode ? true : undefined,
      };
      const res = await fetch(`${FEEDBACK_API_BASE}/feedback/submit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.status === 201) {
        setLocked(true);
        setIsEditMode(false);
        uiNotificationService?.show({
          title: 'Feedback',
          message: 'Feedback ' + (payload.edited ? 'updated' : 'saved'),
          type: 'success',
          duration: 2500,
        });
        await checkSubmissionStatus();
      } else if (res.status === 409) {
        setLocked(true);
        setSubmitMessage('Already submitted for this result.');
        await checkSubmissionStatus();
      } else {
        const text = await res.text();
        setSubmitMessage(text || 'Error while saving');
      }
    } catch (e: any) {
      setSubmitMessage(String(e?.message || e) || 'Network error');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Edit confirmation modal content
  const EditConfirmModal: React.FC<{ hide: () => void; onConfirm: () => void }> = ({ hide, onConfirm }) => {
    return (
      <div className="text-foreground">
        <div className="text-base font-medium mb-2">Edit feedback?</div>
        <div className="text-sm mb-4">You can change your previously submitted feedback for this AI result.</div>
        <div className="flex justify-end space-x-2">
          <FooterAction.Secondary onClick={hide}>Cancel</FooterAction.Secondary>
          <FooterAction.Primary
            onClick={() => {
              onConfirm();
              hide();
            }}
            className="bg-primary-main"
          >
            Enable Editing
          </FooterAction.Primary>
        </div>
      </div>
    );
  };

  const handleStartEdit = useCallback(() => {
    const { uiModalService, uiNotificationService } = servicesManager.services || {};
    const onConfirm = () => {
      setLocked(false);
      setIsEditMode(true);
      uiNotificationService?.show({
        title: 'Feedback',
        message: 'Edit mode enabled',
        type: 'info',
        duration: 2000,
      });
    };
    uiModalService?.show({
      title: 'Confirm Edit',
      content: EditConfirmModal,
      contentProps: { onConfirm },
    });
  }, [servicesManager.services]);

  // Utility to format confidence nicely
  const formatConfidence = (v: number | null | undefined) => {
    if (v === null || v === undefined) return '';
    return `${v.toFixed(1)}%`;
  };

  // --- Render helpers ---
  const renderNoUserPrompt = () => {
    return (
      <div className="flex flex-col h-full p-3 overflow-y-auto text-white bg-black">
        <div className="mb-3 text-sm">Please enter your name to provide feedback.</div>
        <div className="flex items-center space-x-2 mb-3">
          <input
            className="flex-1 bg-gray-800 border border-gray-700 rounded px-2 py-2 text-sm"
            placeholder="Your name"
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
          />
          <button
            className={`px-3 py-2 rounded ${nameInput.trim().length > 0 ? 'bg-primary-main hover:bg-primary-light' : 'bg-gray-700 cursor-not-allowed'}`}
            disabled={nameInput.trim().length === 0}
            onClick={() => {
              const trimmed = nameInput.trim();
              if (trimmed.length === 0) return;
              try {
                window.localStorage.setItem(LOCAL_USER_KEY, trimmed);
              } catch (_) {
                // ignore storage errors
              }
              userAuthenticationService?.setUser?.({ id: trimmed, name: trimmed, source: 'local' });
              setUserDisplayName(trimmed);
              setNameInput('');
            }}
            title={nameInput.trim().length === 0 ? 'Enter a valid name' : 'Save name'}
          >
            Save
          </button>
        </div>
      </div>
    );
  };
  const renderSideSection = (side: 'Left' | 'Right') => {
    if (!currentResult) return null;
    const classification = currentResult.classifications?.find((c: any) => c.side === side);
    const aiLabel = classification?.result || 'Unknown';
    return (
      <div key={side} className="border rounded p-2 mb-3">
        <div className="font-semibold mb-1">{side} Breast</div>
        <div className="text-xs mb-2 text-gray-400">
          AI Prediction: {aiLabel} {formatConfidence(classification?.confidence)}
        </div>
        <div className="flex space-x-4">
          {OPTIONS.map(opt => {
            const isChecked = feedback[side] === opt;
            return (
              <label
                key={opt}
                className={`flex items-center space-x-1 ${
                  locked ? 'cursor-not-allowed' : 'cursor-pointer'
                } ${locked && !isChecked ? 'opacity-50' : ''}`}
              >
                <input
                  type="radio"
                  name={`fb-${side}`}
                  value={opt}
                  checked={isChecked}
                  onChange={() => setFeedbackValue(side, opt)}
                  disabled={locked}
                  style={{
                    accentColor: locked && isChecked ? '#60a5fa' : undefined,
                    WebkitAppearance: locked && isChecked ? 'none' : undefined,
                    appearance: locked && isChecked ? 'none' : undefined,
                    width: locked && isChecked ? '14px' : undefined,
                    height: locked && isChecked ? '14px' : undefined,
                    borderRadius: locked && isChecked ? '50%' : undefined,
                    border: locked && isChecked ? '2px solid #60a5fa' : undefined,
                    backgroundColor: locked && isChecked ? '#60a5fa' : undefined,
                    position: 'relative' as const,
                    cursor: locked ? 'not-allowed' : 'pointer',
                  }}
                />
                <span className={`text-sm font-medium ${
                  locked && isChecked ? 'text-blue-400' :
                  locked ? 'text-gray-500' :
                  'text-white'
                }`}>
                  {opt}
                </span>
              </label>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-full p-3 overflow-y-auto text-white bg-black">
      {!userId ? (
        renderNoUserPrompt()
      ) : (
        <>
      {/* Dropdown for AI result selection */}
      <div className="mb-2">
        <select
          value={selectedUID}
          onChange={handleDropdownChange}
          className="w-full bg-gray-800 border border-gray-700 rounded px-1 py-1 text-sm"
        >
          {aiMeta.map(m => {
            const uid = m.displaySetInstanceUID;
            const mark = hasFeedbackByUID[uid] ? ' ✓' : '';
            return (
              <option key={uid} value={uid}>
                {(m.modelName || 'AI Result') + mark}
              </option>
            );
          })}
        </select>
      </div>

      {/* Navigation buttons */}
      <div className="flex justify-between items-center mb-3 space-x-2">
        <button
          className="flex-1 px-2 py-1 bg-gray-700 rounded hover:bg-gray-600"
          title="Previous AI Result"
          onClick={() => handlePrevNext(-1)}
        >
          ◀ Prev
        </button>
        <button
          className="flex-1 px-2 py-1 bg-gray-700 rounded hover:bg-gray-600"
          title="Next AI Result"
          onClick={() => handlePrevNext(1)}
        >
          Next ▶
        </button>
      </div>

      {/* Active Study Indicator */}
      {activeStudyUID && (
        <div className="mb-3 p-2 bg-gray-800 rounded text-xs">
          <div className="text-gray-400">Active Study:</div>
          <div className="font-mono text-gray-300 break-all">{activeStudyUID}</div>
        </div>
      )}

      {/* AI model info */}
      {currentResult ? (
        <div className="mb-4 text-sm">
          <div>
            <span className="font-medium">Model:</span> {currentResult.modelInfo?.name || 'N/A'}
          </div>
          <div>
            <span className="font-medium">Version:</span> {modelVersion || 'N/A'}
          </div>
          <div>
            <span className="font-medium">Result time:</span> {resultTs || 'Unknown'}
          </div>
        </div>
      ) : (
        <div className="text-sm text-gray-400">No AI result selected.</div>
      )}

      {/* Feedback per side */}
      {['Left', 'Right'].map(side => renderSideSection(side as 'Left' | 'Right'))}

      {/* Submit button and status */}
      <div className="mt-auto space-y-2">
        <button
          className={`w-full py-2 rounded ${
            locked
              ? 'bg-gray-700 cursor-not-allowed'
              : bothSidesChosen && canQueryBackend && !isSubmitting
              ? 'bg-primary-main hover:bg-primary-light'
              : 'bg-gray-700 cursor-not-allowed'
          }`}
          disabled={locked || !bothSidesChosen || !canQueryBackend || isSubmitting}
          onClick={handleSubmit}
          title={
            !bothSidesChosen
              ? 'Select a verdict for both sides'
              : !canQueryBackend
              ? 'Missing model/version/timestamp to identify this AI result'
              : locked
              ? 'Already submitted'
              : ''
          }
        >
          {locked ? 'Submitted' : isSubmitting ? 'Saving…' : 'Submit Feedback'}
        </button>
        {locked ? (
          <div>
            <button
              className={`w-full py-2 rounded ${
                isSubmitting
                  ? 'bg-gray-700 cursor-not-allowed'
                  : 'bg-primary-main hover:bg-primary-light'
              }`}
              disabled={isSubmitting}
              onClick={handleStartEdit}
              title={isSubmitting ? 'Please wait…' : 'Enable editing for this feedback'}
            >
              Edit Feedback
            </button>
          </div>
        ) : (
          submitMessage && <div className="text-xs text-gray-300">{submitMessage}</div>
        )}

        {/* Footer: Signed in user and Change user */}
        <div className="pt-2 border-t border-gray-800">
          <div className="flex items-center justify-between text-xs text-gray-300">
            <div>Signed in as <span className="font-medium">{userId}</span></div>
            <button
              className="px-2 py-1 rounded bg-gray-700 hover:bg-gray-600"
              onClick={() => {
                try {
                  const cfg = (window as any)?.config || {};
                  const routerBasename = cfg?.routerBasename || '/';
                  const configured = cfg?.oidc?.[0]?.post_logout_redirect_uri || '/';
                  const absolute = new URL(configured, window.location.origin).href;
                  const logoutPath = `${routerBasename}${routerBasename.endsWith('/') ? '' : '/'}logout`;
                  window.location.assign(`${logoutPath}?redirect_uri=${encodeURIComponent(absolute)}`);
                } catch (_) {
                  // Fallback with routerBasename
                  const routerBasename = ((window as any)?.config?.routerBasename || '/').replace(/\/$/, '');
                  window.location.assign(`${routerBasename}/logout`);
                }
              }}
              title="Change user"
            >
              Change user
            </button>
          </div>
        </div>
      </div>
        </>
      )}
    </div>
  );
};

export default FeedbackPanel;
