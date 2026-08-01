import React, { useEffect, useLayoutEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useSystem } from '@ohif/core';
import {
  Button,
  Input,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useImageViewer,
  useUserAuthentication,
  useViewportGrid,
} from '@ohif/ui-next';
import { useActiveStudyUID } from '../../hooks/useActiveStudyUID';
import { resultTsFromDisplaySet } from '../../utils/dicomDateTime';
import { fetchFeedbackStatus, findUserVerdict, submitFeedback } from './feedbackApi';
import { useFeedbackUser } from './useFeedbackUser';
import { useResultIdentity, toResultKey, resultIdentityString } from './useResultIdentity';
import { EditConfirmModal } from './EditConfirmModal';

/**
 * Feedback Panel – lets a reader mark Agree / Unsure / Disagree per breast side
 * for the selected AI result, edit a prior verdict, and identify themselves.
 *
 * Concerns are split out of this component: the network client lives in
 * `feedbackApi`, reader identity in `useFeedbackUser`, and the on-screen
 * result's identity in `useResultIdentity`. This component owns the form state
 * and orchestration. Every feedback-status response is applied only while the
 * result+reader identity it was issued for still matches, so a response that
 * resolves after the reader switches result or identity is discarded rather
 * than landing on the wrong record.
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

const FeedbackPanel: React.FC = () => {
  // Access OHIF services
  const { servicesManager } = useSystem();
  // ImageViewerContext is created with `createContext(null)` upstream, so the
  // hook is typed as null; the provider always supplies StudyInstanceUIDs.
  const { StudyInstanceUIDs } = useImageViewer() as unknown as { StudyInstanceUIDs: string[] };
  // UserAuthenticationContext is created with its default STATE object, so the
  // hook is typed as that object even though the provider supplies a
  // [state, api] tuple.
  const [authState] = useUserAuthentication() as unknown as [{ user?: unknown }, unknown];
  const [{ activeViewportId, viewports }] = useViewportGrid();
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
  const [nameInput, setNameInput] = useState<string>('');

  // --- Reader identity (split into useFeedbackUser) ---
  const { userId, saveLocalUser } = useFeedbackUser(authState, userAuthenticationService);

  // Helper to extract study UID from the active viewport
  const getStudyUIDFromActiveViewport = useActiveStudyUID({
    activeViewportId,
    viewports,
    displaySetService,
    StudyInstanceUIDs,
  });

  // Helper to refresh dropdown list & selection info
  const refreshMeta = useCallback(() => {
    if (!aiResultsService || !activeStudyUID) {
      return;
    }
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
      return;
    }
    // This study has no AI results. Drop the previous study's selection: the
    // submit payload takes `study_uid` from the *current* study but the model /
    // version / timestamp from whatever result is still on screen, so a
    // retained selection would file feedback against a (study, result) pair
    // that never existed.
    setSelectedUID('');
  }, [aiResultsService, activeStudyUID, servicesManager]);

  // Helper to refresh the currently displayed AI result
  const refreshCurrent = useCallback(() => {
    if (!aiResultsService || !activeStudyUID) {
      return;
    }
    // Clear on an empty response for the same reason as above — the result on
    // screen must always belong to the study on screen.
    setCurrentResult(
      aiResultsService.getSelectedAIResult?.(activeStudyUID, servicesManager) ?? null
    );
  }, [aiResultsService, activeStudyUID, servicesManager]);

  // Track viewport changes and update activeStudyUID. This also performs the
  // initial resolve — on mount `activeStudyUID` is null, so the inequality below
  // is already true — so no separate mount effect is needed.
  useEffect(() => {
    const studyUID = getStudyUIDFromActiveViewport();
    if (studyUID && studyUID !== activeStudyUID) {
      setActiveStudyUID(studyUID);
      // Reset feedback state when study changes
      setFeedback({ Left: null, Right: null });
      setLocked(false);
      setIsEditMode(false);
      setSubmitMessage('');
      // Note: checkSubmissionStatus will automatically refetch from backend via its useLayoutEffect
    }
  }, [activeViewportId, viewports, getStudyUIDFromActiveViewport, activeStudyUID]);

  // --- Identity of the on-screen AI result (split into useResultIdentity) ---
  const { modelName, modelVersion, resultTs } = useResultIdentity(
    currentResult,
    selectedUID,
    displaySetService
  );

  const resultKey = useMemo(
    () => toResultKey(activeStudyUID, { modelName, modelVersion, resultTs }),
    [activeStudyUID, modelName, modelVersion, resultTs]
  );
  const canQueryBackend = resultKey !== null;

  // A response is applied only if the identity it queried (result + reader)
  // still matches this. Including userId rejects responses that resolve after
  // the reader changes, not only after the result changes.
  const statusIdentity = resultIdentityString(
    activeStudyUID,
    { modelName, modelVersion, resultTs },
    userId
  );
  const statusIdentityRef = useRef<string>(statusIdentity);

  // Initial load
  useEffect(() => {
    refreshMeta();
    refreshCurrent();
  }, [refreshMeta, refreshCurrent]);

  // Subscribe to global selection changes so panel stays in sync
  useEffect(() => {
    if (!aiResultsService) {
      return;
    }
    const { unsubscribe } = aiResultsService.subscribe(
      aiResultsService.EVENTS.AI_RESULT_SELECTED,
      () => {
        refreshMeta();
        refreshCurrent();
      }
    );
    return () => unsubscribe();
  }, [aiResultsService, refreshMeta, refreshCurrent]);

  // Check if this user has already submitted for the selected AI result.
  const checkSubmissionStatus = useCallback(
    async (signal?: AbortSignal) => {
      if (!resultKey || !userId) {
        setLocked(false);
        return;
      }
      // Identity this request is for; compared against the live one before writing.
      const requestIdentity = statusIdentity;
      try {
        const data = await fetchFeedbackStatus(resultKey, signal);
        if (data === null) {
          return;
        }
        // Ignore the response if the selected result / reader changed while it was in flight.
        if (signal?.aborted || requestIdentity !== statusIdentityRef.current) {
          return;
        }
        // Lock if current user already submitted; also prefill selections.
        const u = findUserVerdict(data, userId);
        if (u) {
          setLocked(true);
          const left = INT_TO_VERDICT[Number(u.verdict_L) as 1 | 0 | -1];
          const right = INT_TO_VERDICT[Number(u.verdict_R) as 1 | 0 | -1];
          setFeedback({ Left: left, Right: right });
        } else {
          setLocked(false);
        }
      } catch {
        // Aborted requests and network errors are non-fatal; keep the UI functional.
      }
    },
    [resultKey, statusIdentity, userId]
  );

  useLayoutEffect(() => {
    // Reset the form before paint when the identified result changes: point the
    // identity ref at the current result (so late responses for the old one are
    // rejected) and abort the in-flight fetch on cleanup.
    statusIdentityRef.current = statusIdentity;
    setFeedback({ Left: null, Right: null });
    setLocked(false);
    setIsEditMode(false);
    setSubmitMessage('');

    const controller = new AbortController();
    checkSubmissionStatus(controller.signal);
    return () => controller.abort();
  }, [selectedUID, statusIdentity, checkSubmissionStatus]);

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
            const ts =
              r?.resultTs ||
              (() => {
                // Fallback: derive from display set
                try {
                  const ds = displaySetService?.getDisplaySetByUID(m.displaySetInstanceUID);
                  return resultTsFromDisplaySet(ds);
                } catch (_) {
                  return undefined;
                }
              })();
            if (!name || !version || !ts) {
              return [m.displaySetInstanceUID, false] as const;
            }
            const data = await fetchFeedbackStatus({
              studyUID: String(activeStudyUID),
              modelName: String(name),
              modelVersion: String(version),
              resultTs: String(ts),
            });
            return [m.displaySetInstanceUID, Boolean(findUserVerdict(data, userId))] as const;
          } catch (_) {
            return [m.displaySetInstanceUID, false] as const;
          }
        })
      );
      if (aborted) {
        return;
      }
      const map: Record<string, boolean> = {};
      for (const [uid, has] of entries) {
        map[uid] = has;
      }
      setHasFeedbackByUID(map);
    })();
    return () => {
      aborted = true;
    };
  }, [aiMeta, activeStudyUID, aiResultsService, servicesManager, displaySetService, userId]);

  // --- Interaction handlers ---
  const handleResultSelected = (uid: string) => {
    setSelectedUID(uid);
    if (aiResultsService && activeStudyUID) {
      aiResultsService.setSelectedAIResult(activeStudyUID, uid, servicesManager);
    }
  };

  const handlePrevNext = (direction: -1 | 1) => {
    if (!aiMeta.length) {
      return;
    }
    const index = aiMeta.findIndex(m => m.displaySetInstanceUID === selectedUID);
    if (index === -1) {
      return;
    }
    let nextIndex = index + direction;
    if (nextIndex < 0) {
      nextIndex = aiMeta.length - 1;
    }
    if (nextIndex >= aiMeta.length) {
      nextIndex = 0;
    }
    const nextUID = aiMeta[nextIndex].displaySetInstanceUID;
    aiResultsService.setSelectedAIResult(activeStudyUID, nextUID, servicesManager);
  };

  const setFeedbackValue = (side: 'Left' | 'Right', value: string) => {
    setFeedback(prev => ({ ...prev, [side]: value }));
  };

  const bothSidesChosen = Boolean(feedback.Left && feedback.Right);

  const handleSubmit = async () => {
    setSubmitMessage('');
    if (!bothSidesChosen || !resultKey || !userId) {
      return;
    }
    // Identity being submitted; its outcome is applied only while it stays current.
    const submitIdentity = statusIdentity;
    setIsSubmitting(true);
    try {
      const { uiNotificationService } = servicesManager.services || {};
      const payload = {
        study_uid: resultKey.studyUID,
        model_name: resultKey.modelName,
        model_version: resultKey.modelVersion,
        result_ts: resultKey.resultTs,
        user_id: userId,
        verdict_L: VERDICT_TO_INT[feedback.Left as 'Agree' | 'Unsure' | 'Disagree'],
        verdict_R: VERDICT_TO_INT[feedback.Right as 'Agree' | 'Unsure' | 'Disagree'],
        edited: isEditMode ? true : undefined,
      };
      const res = await submitFeedback(payload);
      // Drop the outcome if the selected result changed while the POST was in flight.
      if (submitIdentity !== statusIdentityRef.current) {
        return;
      }
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
        // Re-check after the second await (reading the body).
        if (submitIdentity !== statusIdentityRef.current) {
          return;
        }
        setSubmitMessage(text || 'Error while saving');
      }
    } catch (e: any) {
      if (submitIdentity === statusIdentityRef.current) {
        setSubmitMessage(String(e?.message || e) || 'Network error');
      }
    } finally {
      setIsSubmitting(false);
    }
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
    // UIModalService.show's parameter defaults are all `= null` with no type
    // annotations, so TS infers `null` for every field of the options object.
    uiModalService?.show({
      title: 'Confirm Edit',
      content: EditConfirmModal,
      contentProps: { onConfirm },
    } as unknown as Parameters<AppTypes.UIModalService['show']>[0]);
  }, [servicesManager.services]);

  // Utility to format confidence nicely
  const formatConfidence = (v: number | null | undefined) => {
    if (v === null || v === undefined) {
      return '';
    }
    return `${v.toFixed(1)}%`;
  };

  // --- Render helpers ---
  const renderNoUserPrompt = () => {
    return (
      <div className="bg-background text-foreground flex h-full flex-col overflow-y-auto p-3">
        <div className="mb-3 text-sm">Please enter your name to provide feedback.</div>
        <div className="mb-3 flex items-center space-x-2">
          <Input
            // min-w-0: a flex item will not shrink below its intrinsic width by
            // default, which pushed Save off the edge of this narrow panel.
            className="min-w-0 flex-1"
            placeholder="Your name"
            value={nameInput}
            onChange={e => setNameInput(e.target.value)}
          />
          <Button
            disabled={nameInput.trim().length === 0}
            onClick={() => {
              saveLocalUser(nameInput);
              setNameInput('');
            }}
            title={nameInput.trim().length === 0 ? 'Enter a valid name' : 'Save name'}
          >
            Save
          </Button>
        </div>
      </div>
    );
  };
  const renderSideSection = (side: 'Left' | 'Right') => {
    if (!currentResult) {
      return null;
    }
    const classification = currentResult.classifications?.find((c: any) => c.side === side);
    const aiLabel = classification?.result || 'Unknown';
    return (
      <div
        key={side}
        className="border-input mb-3 rounded border p-2"
      >
        <div className="mb-1 font-semibold">{side} Breast</div>
        <div className="text-muted-foreground mb-2 text-xs">
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
                  // `accent-highlight` keeps the recorded choice legible once the
                  // form locks: a disabled radio is dimmed by the browser, and
                  // the accent is the only thing that still reads as "chosen".
                  className="accent-highlight"
                />
                <span
                  className={`text-sm font-medium ${
                    locked && isChecked
                      ? 'text-highlight'
                      : locked
                        ? 'text-muted-foreground'
                        : 'text-foreground'
                  }`}
                >
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
    <div className="bg-background text-foreground flex h-full flex-col overflow-y-auto p-3">
      {!userId ? (
        renderNoUserPrompt()
      ) : (
        <>
          {/* Dropdown for AI result selection */}
          <div className="mb-2">
            <Select
              value={selectedUID}
              onValueChange={handleResultSelected}
            >
              <SelectTrigger aria-label="AI result">
                <SelectValue placeholder="Select AI result" />
              </SelectTrigger>
              <SelectContent>
                {aiMeta.map(m => {
                  const uid = m.displaySetInstanceUID;
                  const mark = hasFeedbackByUID[uid] ? ' ✓' : '';
                  return (
                    <SelectItem
                      key={uid}
                      value={uid}
                    >
                      {(m.modelName || 'AI Result') + mark}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>

          {/* Navigation buttons */}
          <div className="mb-3 flex items-center justify-between space-x-2">
            <Button
              variant="secondary"
              className="flex-1"
              title="Previous AI Result"
              onClick={() => handlePrevNext(-1)}
            >
              ◀ Prev
            </Button>
            <Button
              variant="secondary"
              className="flex-1"
              title="Next AI Result"
              onClick={() => handlePrevNext(1)}
            >
              Next ▶
            </Button>
          </div>

          {/* Active Study Indicator */}
          {activeStudyUID && (
            <div className="bg-muted mb-3 rounded p-2 text-xs">
              <div className="text-muted-foreground">Active Study:</div>
              <div className="text-muted-foreground break-all font-mono">{activeStudyUID}</div>
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
            <div className="text-muted-foreground text-sm">No AI result selected.</div>
          )}

          {/* Feedback per side */}
          {['Left', 'Right'].map(side => renderSideSection(side as 'Left' | 'Right'))}

          {/* Submit button and status */}
          <div className="mt-auto space-y-2">
            <Button
              className="w-full"
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
            </Button>
            {locked ? (
              <div>
                <Button
                  className="w-full"
                  disabled={isSubmitting}
                  onClick={handleStartEdit}
                  title={isSubmitting ? 'Please wait…' : 'Enable editing for this feedback'}
                >
                  Edit Feedback
                </Button>
              </div>
            ) : (
              submitMessage && <div className="text-muted-foreground text-xs">{submitMessage}</div>
            )}

            {/* Footer: Signed in user and Change user */}
            <div className="border-input border-t pt-2">
              <div className="text-muted-foreground flex items-center justify-between text-xs">
                <div>
                  Signed in as <span className="font-medium">{userId}</span>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    try {
                      const cfg = (window as any)?.config || {};
                      const routerBasename = cfg?.routerBasename || '/';
                      const configured = cfg?.oidc?.[0]?.post_logout_redirect_uri || '/';
                      const absolute = new URL(configured, window.location.origin).href;
                      const logoutPath = `${routerBasename}${routerBasename.endsWith('/') ? '' : '/'}logout`;
                      window.location.assign(
                        `${logoutPath}?redirect_uri=${encodeURIComponent(absolute)}`
                      );
                    } catch (_) {
                      // Fallback with routerBasename
                      const routerBasename = (
                        (window as any)?.config?.routerBasename || '/'
                      ).replace(/\/$/, '');
                      window.location.assign(`${routerBasename}/logout`);
                    }
                  }}
                  title="Change user"
                >
                  Change user
                </Button>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default FeedbackPanel;
