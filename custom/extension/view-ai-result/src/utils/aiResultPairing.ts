import { dicomDateTimeToIsoUtc } from './dicomDateTime';

/**
 * Pairing between an AI structured report (SR) and its heatmap secondary
 * capture (SC).
 *
 * This module pairs by, in order of confidence:
 *   1. Referenced SOP-instance identity — the SR references the SC's SOP
 *      instance (or vice-versa). This is authoritative when present.
 *   2. Creation-time proximity within a small window — absorbs fractional /
 *      rounded timestamp differences while still refusing far-apart series.
 *
 * Exact `InstanceCreationDate` + `InstanceCreationTime` string equality is
 * deliberately NOT used: any sub-second or rounding difference leaves a valid
 * heatmap unpaired, and it can pair the wrong SC when several models ran on
 * the same study.
 *
 * A single {@link findMatch} helper serves both directions (SR→SC and SC→SR).
 */

/** Bound the recursive walk over referenced sequences (defensive; DICOM
 * metadata is a tree, but depth-limit + visited-set guard against surprises). */
const MAX_REF_DEPTH = 6;

/**
 * Window (ms) within which two creation timestamps are treated as the same
 * acquisition when no referenced-UID link is available. Wide enough to absorb
 * sub-second/rounding differences, narrow enough not to pair distinct runs.
 */
export const PAIRING_TIME_WINDOW_MS = 2000;

function addTruthy(set: Set<string>, value: unknown): void {
  if (typeof value === 'string' && value.length > 0) {
    set.add(value);
  }
}

/** SOP Instance UIDs that a display set *is* (its own instances). */
export function ownSopInstanceUIDs(displaySet: any): Set<string> {
  const out = new Set<string>();
  if (!displaySet) {
    return out;
  }
  addTruthy(out, displaySet.instance?.SOPInstanceUID);
  addTruthy(out, displaySet.SOPInstanceUID);
  const fromList = (list: any[]) => {
    if (Array.isArray(list)) {
      list.forEach(item => addTruthy(out, item?.SOPInstanceUID));
    }
  };
  fromList(displaySet.instances);
  fromList(displaySet.images);
  return out;
}

/**
 * The canonical SOP Instance UID identifying a display set — its DICOM identity
 * (ODV-223). Prefers the single `instance.SOPInstanceUID` (SR documents and SC
 * images are single-instance display sets), then a display-set-level
 * `SOPInstanceUID`, then the first UID from its `instances`/`images` lists.
 * Returns undefined only when the display set carries no SOP Instance UID at all
 * — in which case callers fall back to a session-stable identity so that
 * distinct display sets are still never grouped together.
 */
export function primarySopInstanceUID(displaySet: any): string | undefined {
  const direct = displaySet?.instance?.SOPInstanceUID ?? displaySet?.SOPInstanceUID;
  if (typeof direct === 'string' && direct.length > 0) {
    return direct;
  }
  // ownSopInstanceUIDs preserves insertion order (instance → own → instances → images);
  // the first entry is the most specific available identity.
  for (const uid of ownSopInstanceUIDs(displaySet)) {
    return uid;
  }
  return undefined;
}

/**
 * SOP Instance UIDs *referenced* by a display set, collected by a bounded
 * recursive walk over its `instance` metadata (covers ReferencedImageSequence,
 * evidence sequences, content-sequence references, etc. without hard-coding a
 * DICOM structure we don't have concrete samples for).
 */
export function referencedSopInstanceUIDs(displaySet: any): Set<string> {
  const out = new Set<string>();
  const seen = new WeakSet<object>();

  const walk = (node: any, depth: number): void => {
    if (node == null || depth > MAX_REF_DEPTH || typeof node !== 'object') {
      return;
    }
    if (seen.has(node)) {
      return;
    }
    seen.add(node);

    if (Array.isArray(node)) {
      node.forEach(item => walk(item, depth + 1));
      return;
    }

    for (const key of Object.keys(node)) {
      if (key === 'ReferencedSOPInstanceUID') {
        addTruthy(out, node[key]);
      } else {
        walk(node[key], depth + 1);
      }
    }
  };

  walk(displaySet?.instance, 0);
  return out;
}

/** True when either display set references the other's SOP instance. */
export function haveSopIdentityLink(a: any, b: any): boolean {
  const aOwn = ownSopInstanceUIDs(a);
  const bRefs = referencedSopInstanceUIDs(b);
  for (const uid of aOwn) {
    if (bRefs.has(uid)) {
      return true;
    }
  }
  const bOwn = ownSopInstanceUIDs(b);
  const aRefs = referencedSopInstanceUIDs(a);
  for (const uid of bOwn) {
    if (aRefs.has(uid)) {
      return true;
    }
  }
  return false;
}

/**
 * Epoch (ms) of a display set's DICOM instance creation date+time, or
 * `undefined` when either is missing/malformed. Requiring both date and time
 * enforces a "date and time present" contract; the conversion tolerates
 * fractional seconds so rounding does not break pairing.
 */
export function creationEpochMs(displaySet: any): number | undefined {
  const date = displaySet?.instance?.InstanceCreationDate;
  const time = displaySet?.instance?.InstanceCreationTime;
  if (!date || !time) {
    return undefined;
  }
  const iso = dicomDateTimeToIsoUtc(date, time, displaySet.instance?.TimezoneOffsetFromUTC || null);
  if (!iso) {
    return undefined;
  }
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : ms;
}

export interface FindMatchOptions {
  /**
   * Model name of the source result. Used only as a tiebreaker among otherwise
   * equally-good candidates (e.g. two SCs referenced by / equidistant from the
   * SR) — prefer the candidate whose series description names the model.
   */
  modelName?: string;
}

function matchesModelName(candidate: any, modelName?: string): boolean {
  if (!modelName) {
    return false;
  }
  const desc = candidate?.SeriesDescription;
  return typeof desc === 'string' && desc.toLowerCase().includes(modelName.toLowerCase());
}

/**
 * Pick the candidate display set that pairs with `source`.
 *
 * Referenced-UID identity is authoritative when present. Otherwise the closest
 * candidate by creation-time proximity is used, but only within
 * {@link PAIRING_TIME_WINDOW_MS}. Returns `null` when nothing qualifies.
 */
export function findMatch(source: any, candidates: any[], opts: FindMatchOptions = {}): any | null {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const linked = candidates.filter(c => haveSopIdentityLink(source, c));
  const pool = linked.length > 0 ? linked : candidates;

  const srcMs = creationEpochMs(source);
  // Rank by creation-time distance (primary, ascending); a model-name match is
  // only a *secondary* tiebreak among equally-close candidates — never a nudge
  // that could let a farther candidate overtake a strictly closer one. Array
  // sort is stable, so equal candidates keep their input order (deterministic).
  const scored = pool.map(candidate => {
    const candMs = creationEpochMs(candidate);
    const diff =
      srcMs !== undefined && candMs !== undefined ? Math.abs(candMs - srcMs) : Infinity;
    return { candidate, diff, modelMatch: matchesModelName(candidate, opts.modelName) };
  });
  scored.sort((a, b) => a.diff - b.diff || Number(b.modelMatch) - Number(a.modelMatch));

  const best = scored[0];
  const runnerUp = scored[1];
  // Ambiguous only when the runner-up is just as good on BOTH keys.
  const tie =
    !!runnerUp && runnerUp.diff === best.diff && runnerUp.modelMatch === best.modelMatch;

  if (linked.length > 0) {
    // Referenced-UID identity is authoritative; use the closest linked candidate
    // (or the first, when timestamps are unavailable).
    return best.candidate;
  }

  // No identity link: require creation-time proximity within the window AND an
  // unambiguous winner. When two candidates are equally close (e.g. two heatmaps
  // stamped at the same second as two same-second reports, none carrying a
  // referenced UID), the data cannot tell us which belongs to which — refuse to
  // guess rather than silently attach a heatmap to the wrong report.
  if (best.diff <= PAIRING_TIME_WINDOW_MS && !tie) {
    return best.candidate;
  }
  return null;
}

/** Find the heatmap (SC) that pairs with an AI result (SR). */
export function findMatchingHeatmap(
  srDisplaySet: any,
  scDisplaySets: any[],
  modelName?: string
): any | null {
  return findMatch(srDisplaySet, scDisplaySets, { modelName });
}

/** Find the AI result (SR) that pairs with a heatmap (SC) — the reverse pairing. */
export function findMatchingSRForHeatmap(scDisplaySet: any, srDisplaySets: any[]): any | null {
  return findMatch(scDisplaySet, srDisplaySets);
}
