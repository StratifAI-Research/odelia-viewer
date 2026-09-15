import React, { createContext, useContext, useEffect, useState, useMemo } from 'react';
import { useUserAuthentication } from '@ohif/ui-next';
import { CACHE_KEY, HOUR, checkRelease, stableVersion, type Release } from './releaseClient';

export type UpdateConfig = {
  enabled?: boolean;
  checkIntervalHours?: number;
};
type AppConfig = {
  viewerUpdates?: UpdateConfig;
  routerBasename?: string;
  oidc?: { authority?: string }[];
};
type AuthenticationState = {
  user: {
    profile: { sub?: string; iss?: string };
    expired?: boolean;
  } | null;
};
type UpdateState = {
  release: Release | null;
  installed: string;
  identity: string | null;
  basePath: string;
};
const UpdateContext = createContext<UpdateState>({
  release: null,
  installed: '',
  identity: null,
  basePath: '/',
});
export const useReleaseUpdate = () => useContext(UpdateContext);

export default function ReleaseUpdateProvider({
  children,
  appConfig,
}: {
  children: React.ReactNode;
  appConfig: AppConfig;
}) {
  // OHIF infers this hook from its object default, but the provider supplies [state, api].
  const [{ user }] = useUserAuthentication() as unknown as [AuthenticationState, unknown];
  const installed = stableVersion(process.env.ODELIA_PRODUCT_VERSION) || '';
  const options = appConfig.viewerUpdates;
  const enabled =
    options?.enabled ?? (process.env.NODE_ENV === 'production' && process.env.TEST_ENV !== 'true');
  const oidc = appConfig.oidc?.[0];
  const subject = user?.profile?.sub;
  const authenticated = !oidc || Boolean(subject && !user?.expired);
  const identitySource = authenticated
    ? oidc
      ? `${user?.profile?.iss || oidc.authority}:${subject}`
      : 'anonymous'
    : null;
  const identity = useMemo(() => {
    if (!identitySource || identitySource === 'anonymous') {
      return identitySource;
    }
    // Stable opaque local keys work on HTTP installations as well as HTTPS.
    let a = 2166136261;
    let b = 5381;
    for (const char of identitySource) {
      a = Math.imul(a ^ char.charCodeAt(0), 16777619);
      b = Math.imul(b, 33) ^ char.charCodeAt(0);
    }
    return `user-${a >>> 0}-${b >>> 0}`;
  }, [identitySource]);
  const [release, setRelease] = useState<Release | null>(null);
  const hours = options?.checkIntervalHours;
  const interval =
    typeof hours === 'number' && Number.isFinite(hours)
      ? Math.min(168, Math.max(1, hours)) * HOUR
      : 24 * HOUR;

  useEffect(() => {
    if (!enabled || !installed || !authenticated) {
      return;
    }
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const run = async () => {
      if (document.visibilityState === 'hidden') {
        return;
      }
      const result = await checkRelease(interval);
      if (active) {
        setRelease(previous =>
          previous?.version === result?.version && previous?.url === result?.url ? previous : result
        );
        clearTimeout(timer);
        timer = setTimeout(run, Math.min(interval, HOUR));
      }
    };
    const schedule = () => {
      clearTimeout(timer);
      if (document.visibilityState !== 'hidden') {
        timer = setTimeout(run, 0);
      }
    };
    const storage = (event: StorageEvent) => {
      if (event.key === CACHE_KEY || event.key === null) {
        schedule();
      }
    };
    schedule();
    document.addEventListener('visibilitychange', schedule);
    window.addEventListener('storage', storage);
    return () => {
      active = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', schedule);
      window.removeEventListener('storage', storage);
    };
  }, [enabled, installed, authenticated, interval]);

  return (
    <UpdateContext.Provider
      value={{
        release: enabled && authenticated ? release : null,
        installed,
        identity,
        basePath: appConfig.routerBasename || '/',
      }}
    >
      {children}
    </UpdateContext.Provider>
  );
}
