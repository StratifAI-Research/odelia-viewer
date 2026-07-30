import { useCallback, useEffect, useState } from 'react';

/**
 * Reader identity for the feedback panel (the identity half of the split).
 *
 * Resolves a stable user id from, in order: the OHIF authentication service /
 * auth state, a locally-typed display name, and a persisted localStorage name.
 * Also exposes `saveLocalUser` for the "enter your name" prompt.
 */

// Local storage key for simple, quick user identification
export const LOCAL_USER_KEY = 'ohif.aiFeedback.displayName';

// Extract a stable user identifier from an authentication service response.
export function extractUserIdFromAuth(svcUser: any): string | null {
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
      if (candidate && String(candidate).trim().length > 0) {
        return String(candidate).trim();
      }
    }
  } catch (_) {
    // ignore
  }
  return null;
}

export interface FeedbackUser {
  /** Resolved stable identity, or null when none can be determined. */
  userId: string | null;
  /** Persist a locally-typed display name and reflect it into the auth service. */
  saveLocalUser: (name: string) => void;
}

export function useFeedbackUser(authState: any, userAuthenticationService: any): FeedbackUser {
  const [userDisplayName, setUserDisplayName] = useState<string | null>(null);

  const deriveUserId = useCallback((): string | null => {
    try {
      const svcUser = authState?.user ?? userAuthenticationService?.getUser?.();
      const authId = extractUserIdFromAuth(svcUser);
      if (authId) {
        return authId;
      }
    } catch (_) {
      // ignore
    }
    if (userDisplayName && userDisplayName.trim().length > 0) {
      return userDisplayName.trim();
    }
    try {
      const stored = window.localStorage.getItem(LOCAL_USER_KEY);
      if (stored && stored.trim().length > 0) {
        return stored.trim();
      }
    } catch (_) {
      // ignore storage errors
    }
    return null;
  }, [authState, userAuthenticationService, userDisplayName]);

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
        userAuthenticationService?.setUser?.({
          id: stored.trim(),
          name: stored.trim(),
          source: 'local',
        });
      }
    } catch (_) {
      // ignore
    }
  }, [userAuthenticationService]);

  useEffect(() => {
    ensureUserInitialized();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveLocalUser = useCallback(
    (name: string) => {
      const trimmed = name.trim();
      if (trimmed.length === 0) {
        return;
      }
      try {
        window.localStorage.setItem(LOCAL_USER_KEY, trimmed);
      } catch (_) {
        // ignore storage errors
      }
      userAuthenticationService?.setUser?.({ id: trimmed, name: trimmed, source: 'local' });
      setUserDisplayName(trimmed);
    },
    [userAuthenticationService]
  );

  return { userId: deriveUserId(), saveLocalUser };
}
