import { useMemo } from 'react';
import { resultTsFromDisplaySet } from '../../utils/dicomDateTime';
import { FeedbackResultKey } from './feedbackApi';

/**
 * Derives the identity fields (model name/version + result timestamp) of the AI
 * result currently on screen (H-11: the identity half of the split). These
 * three fields plus the study and reader identify a feedback record.
 */
export interface ResultIdentity {
  modelName: string | undefined;
  modelVersion: string | undefined;
  resultTs: string | undefined;
}

export function useResultIdentity(
  currentResult: any,
  selectedUID: string,
  displaySetService: any
): ResultIdentity {
  const modelName = useMemo<string | undefined>(
    () =>
      currentResult?.modelInfo?.name ||
      currentResult?.modelName ||
      currentResult?.model?.name ||
      undefined,
    [currentResult]
  );

  const modelVersion = useMemo<string | undefined>(
    () =>
      currentResult?.modelInfo?.algorithmVersion ||
      currentResult?.modelVersion ||
      currentResult?.model?.version ||
      undefined,
    [currentResult]
  );

  const resultTs = useMemo<string | undefined>(() => {
    const r = currentResult || {};
    const direct = r.resultTs || r.result_ts || r.resultTimestamp || r.createdAt || r.timestamp;
    if (typeof direct === 'string' && direct.length > 0) return direct;
    // Derive from the selected SR display set creation date/time.
    try {
      const sr = selectedUID ? displaySetService?.getDisplaySetByUID(selectedUID) : null;
      return resultTsFromDisplaySet(sr);
    } catch (_) {
      return undefined;
    }
  }, [currentResult, selectedUID, displaySetService]);

  return { modelName, modelVersion, resultTs };
}

/**
 * Build the {@link FeedbackResultKey} for a result, or `null` when any field is
 * missing (backend cannot be queried without a complete key).
 */
export function toResultKey(
  activeStudyUID: string | null,
  identity: ResultIdentity
): FeedbackResultKey | null {
  const { modelName, modelVersion, resultTs } = identity;
  if (!activeStudyUID || !modelName || !modelVersion || !resultTs) {
    return null;
  }
  return { studyUID: activeStudyUID, modelName, modelVersion, resultTs };
}

/**
 * Stable identity string for the on-screen result, including the reader. A
 * feedback-status response is applied only while this string still matches, so
 * including `userId` rejects a response that resolved after the reader changed
 * (not just after the result changed).
 */
export function resultIdentityString(
  activeStudyUID: string | null,
  identity: ResultIdentity,
  userId: string | null
): string {
  return `${activeStudyUID}||${identity.modelName}||${identity.modelVersion}||${identity.resultTs}||${userId}`;
}
