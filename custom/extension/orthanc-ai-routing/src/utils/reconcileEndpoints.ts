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

const sameEndpoint = (a: AIEndpoint, b: AIEndpoint): boolean =>
  a.name === b.name && a.url === b.url;

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
