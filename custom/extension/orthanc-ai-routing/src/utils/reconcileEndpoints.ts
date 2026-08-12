import type { AIEndpoint } from '../components/AIEndpointConfig';

/**
 * Reconcile the stored endpoint list against `window.config.aiEndpoints`.
 *
 * The stored list used to win outright: config was consulted only when
 * localStorage was empty, and the result was written straight back. Since that
 * write guaranteed localStorage would be non-empty forever after, editing
 * `aiEndpoints` in app-config.js — the documented, rebuild-free way to
 * configure the viewer — never reached any browser that had opened it once.
 * The symptom ("I changed the config and nothing happened") looks like a failed
 * deploy, which is what makes it expensive.
 *
 * Simply letting config win instead would trade one problem for another: it
 * would discard endpoints a user added by hand, and silently revert their edits
 * on every reload.
 *
 * So this is a three-way merge against the config list as it looked when it was
 * last reconciled (the "base"). That extra snapshot is what makes the two cases
 * distinguishable: an entry that differs from the base changed *in config* and
 * should be applied, while one that differs only from the stored list was
 * changed *by the user* and should be left alone.
 */

/** Snapshot of the config list as of the last reconcile, keyed alongside it. */
export const AI_ENDPOINTS_CONFIG_BASE_KEY = 'aiEndpoints.configBase';

/** Two endpoints carry the same configuration (id is identity, not configuration). */
export const sameEndpoint = (a: AIEndpoint, b: AIEndpoint): boolean =>
  a.name === b.name && a.url === b.url;

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim() !== '';

// All three fields, all non-empty. `name` is not decoration: it is what the
// dropdown labels and what `routeSeriesToAI` sends as `target`, so an entry
// without one produces a blank row and a payload whose `target` is dropped by
// JSON.stringify. An empty id collides with every other empty id in `byId`.
const isEndpointShaped = (value: unknown): value is AIEndpoint =>
  !!value &&
  typeof value === 'object' &&
  !Array.isArray(value) &&
  isNonEmptyString((value as AIEndpoint).id) &&
  isNonEmptyString((value as AIEndpoint).name) &&
  isNonEmptyString((value as AIEndpoint).url);

/**
 * The endpoint list a deployment declares, or `null` when it has no usable
 * opinion and reconciliation must be skipped entirely.
 *
 * The distinction matters because an empty list is MEANINGFUL here: it means
 * "the deployment removed its endpoints", and the merge below will duly drop
 * them. So a malformed value must not be flattened to `[]` -- doing that would
 * delete the operator's real endpoints and silently fall back to the built-in
 * default, on the strength of a typo. It reads as "I changed the config and the
 * viewer forgot everything", which is a nasty thing to debug.
 *
 * A `window.config` that is missing altogether is treated the same way: the app
 * config has not been applied yet, which is not the same as declaring nothing.
 *
 * `aiEndpoints` genuinely absent from a loaded config IS an opinion, and returns
 * `[]`. That case is indistinguishable from a mistyped key at runtime, and the
 * remove-what-config-removed behaviour is what the merge exists to provide.
 */
export function readConfiguredEndpoints(config: unknown): AIEndpoint[] | null {
  if (!config || typeof config !== 'object') {
    return null;
  }

  const declared = (config as { aiEndpoints?: unknown }).aiEndpoints;

  // Absent means the config version has no opinion, which IS an opinion here:
  // the merge will drop what a previous version declared. `null` is different —
  // a value was written and it is not a list. `[]` is how a deployment says
  // "no endpoints", so `null` is a mistake, and mistakes must not delete data.
  if (declared === undefined) {
    return [];
  }

  const reject = (why: string) => {
    console.error(
      `window.config.aiEndpoints ${why}; ignoring it and keeping the stored endpoints. ` +
        'Fix the value in app-config.js — use [] to declare no endpoints.',
      declared
    );
    return null;
  };

  if (!Array.isArray(declared)) {
    return reject('is not an array');
  }

  if (!declared.every(isEndpointShaped)) {
    return reject('contains entries that are not { id, name, url } with non-empty strings');
  }

  const ids = new Set(declared.map(endpoint => endpoint.id));

  if (ids.size !== declared.length) {
    // `byId` would silently keep only the last of each duplicate, quietly losing
    // an endpoint the deployment believes it configured.
    return reject('contains duplicate ids');
  }

  return declared as AIEndpoint[];
}

const byId = (endpoints: AIEndpoint[]): Map<string, AIEndpoint> =>
  new Map(endpoints.map(endpoint => [endpoint.id, endpoint]));

export interface ReconcileInput {
  /** Endpoints currently in localStorage. */
  stored: AIEndpoint[];
  /** Endpoints declared in `window.config.aiEndpoints`. */
  config: AIEndpoint[];
  /**
   * The config list as of the last reconcile. `null` for a browser that stored
   * its list before this merge existed — see the first-run note below.
   */
  base: AIEndpoint[] | null;
}

/**
 * Merge config changes into the stored list, preserving user-owned entries.
 *
 * Ordering follows config, so the list a deployment declares reads the way it
 * was written, with user-added endpoints kept at the end in their existing
 * order.
 */
export function reconcileEndpoints({ stored, config, base }: ReconcileInput): AIEndpoint[] {
  // Nothing stored yet: config is the whole answer.
  if (stored.length === 0) {
    return [...config];
  }

  const storedById = byId(stored);
  const configById = byId(config);

  // First run against a list stored before this merge existed. There is no
  // record of what config used to say, so a difference cannot be attributed to
  // either side. Treat config as the base: adopt entries the user has never
  // seen, leave everything already present untouched. Every subsequent load has
  // a real base and gets the full merge.
  const baseById = base ? byId(base) : configById;

  const merged: AIEndpoint[] = [];

  for (const configEndpoint of config) {
    const storedEndpoint = storedById.get(configEndpoint.id);

    if (!storedEndpoint) {
      // Added in config, or never stored locally.
      merged.push(configEndpoint);
      continue;
    }

    const baseEndpoint = baseById.get(configEndpoint.id);
    const changedInConfig = !baseEndpoint || !sameEndpoint(baseEndpoint, configEndpoint);

    // Config changed since the last reconcile, so it wins. Otherwise the stored
    // copy is either identical or carries a deliberate user edit — keep it.
    merged.push(changedInConfig ? configEndpoint : storedEndpoint);
  }

  for (const storedEndpoint of stored) {
    if (configById.has(storedEndpoint.id)) {
      continue; // already emitted above, in config order
    }
    // Present in the base but gone from config: the deployment removed it.
    if (baseById.has(storedEndpoint.id)) {
      continue;
    }
    // User-added — config has no opinion about it.
    merged.push(storedEndpoint);
  }

  return merged;
}
