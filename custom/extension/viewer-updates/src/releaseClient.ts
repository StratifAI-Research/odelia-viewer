import valid from 'semver/functions/valid';
import gt from 'semver/functions/gt';
import prerelease from 'semver/functions/prerelease';

export const REPOSITORY = 'StratifAI-Research/odelia-viewer';
export const ENDPOINT = `https://api.github.com/repos/${REPOSITORY}/releases/latest`;
export const CACHE_KEY = `odelia:updates:v1:${REPOSITORY}`;
export const HOUR = 60 * 60 * 1000;
export type Release = { version: string; url: string };
type Cache = { release: Release | null; checkedAt: number; nextAttemptAt: number };
let memory: Cache | undefined;
let pending: Promise<Release | null> | undefined;

export function stableVersion(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }
  const version = valid(value.trim().replace(/^v/, ''));
  return version && !prerelease(version) ? version : null;
}

export function newer(release: Release | null, installed: string): boolean {
  const version = stableVersion(installed);
  return Boolean(release && version && gt(release.version, version));
}

export function parseRelease(value: unknown): Release | null {
  const data = value as Record<string, unknown>;
  if (!data || data.draft !== false || data.prerelease !== false) {
    return null;
  }
  const version = stableVersion(data.tag_name);
  try {
    const url = new URL(String(data.html_url));
    if (
      !version ||
      url.protocol !== 'https:' ||
      url.host !== 'github.com' ||
      url.username ||
      url.password ||
      !url.pathname.startsWith(`/${REPOSITORY}/releases/tag/`) ||
      !url.pathname.slice(`/${REPOSITORY}/releases/tag/`.length)
    ) {
      return null;
    }
    return { version, url: url.href };
  } catch {
    return null;
  }
}

export function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Browsing without persistent storage still supports in-memory checks.
  }
}

function readCache(now: number): Cache | undefined {
  try {
    const raw = readStorage(CACHE_KEY);
    const cache = raw ? JSON.parse(raw) : memory;
    if (
      !cache ||
      !Number.isFinite(cache.checkedAt) ||
      !Number.isFinite(cache.nextAttemptAt) ||
      cache.checkedAt < 0 ||
      cache.checkedAt > now ||
      cache.nextAttemptAt < cache.checkedAt ||
      cache.nextAttemptAt > now + 7 * 24 * HOUR
    ) {
      return undefined;
    }
    if (
      cache.release !== null &&
      !parseRelease({
        tag_name: cache.release.version,
        html_url: cache.release.url,
        draft: false,
        prerelease: false,
      })
    ) {
      return undefined;
    }
    return cache;
  } catch {
    return memory;
  }
}

export function checkRelease(interval: number): Promise<Release | null> {
  if (pending) {
    return pending;
  }
  const now = Date.now();
  const cache = readCache(now);
  if (cache && cache.nextAttemptAt > now) {
    return Promise.resolve(now - cache.checkedAt < interval ? cache.release : null);
  }

  pending = (async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    let nextAttemptAt = now + HOUR;
    try {
      const response = await fetch(ENDPOINT, {
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        signal: controller.signal,
      });
      if (response.status === 403 || response.status === 429) {
        const retry = response.headers.get('Retry-After');
        const retryAt =
          retry && /^\d+$/.test(retry) ? now + Number(retry) * 1000 : Date.parse(retry || '');
        const resetAt = Number(response.headers.get('X-RateLimit-Reset')) * 1000;
        nextAttemptAt = Math.min(
          now + 7 * 24 * HOUR,
          Math.max(nextAttemptAt, retryAt || 0, resetAt || 0)
        );
      } else if (response.status === 404) {
        nextAttemptAt = now + interval;
      } else if (response.ok) {
        const release = parseRelease(await response.json());
        if (release) {
          memory = { release, checkedAt: now, nextAttemptAt: now + interval };
          writeStorage(CACHE_KEY, JSON.stringify(memory));
          return release;
        }
      }
    } catch {
      // Update discovery must not affect viewing or authentication.
    } finally {
      clearTimeout(timeout);
    }
    memory = { release: null, checkedAt: now, nextAttemptAt };
    writeStorage(CACHE_KEY, JSON.stringify(memory));
    return null;
  })().finally(() => {
    pending = undefined;
  });
  return pending;
}
