import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { hasPermission, type Permission, type SessionUser } from '@ifp/shared';
import { authApi } from '../api/endpoints';
import { setAccessToken, setUnauthorizedHandler } from '../api/client';

interface AuthState {
  user: SessionUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<SessionUser>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  can: (permission: Permission) => boolean;
}

const AuthContext = createContext<AuthState | null>(null);

/**
 * Single-flight guard for the bootstrap refresh.
 *
 * React 18 StrictMode runs effects twice in development. Two refresh calls
 * would present the SAME rotating token, the second one after the first had
 * already spent it — which the API correctly treats as token reuse and
 * responds to by revoking the whole family, logging the user straight back
 * out. Holding the promise at module scope means the second invocation joins
 * the first rather than racing it.
 */
let bootstrapPromise: ReturnType<typeof authApi.refresh> | null = null;

function bootstrapSession() {
  if (!bootstrapPromise) {
    bootstrapPromise = authApi.refresh();
    // Let a later sign-in start a fresh bootstrap.
    void bootstrapPromise.catch(() => undefined).finally(() => {
      setTimeout(() => {
        bootstrapPromise = null;
      }, 0);
    });
  }
  return bootstrapPromise;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  /**
   * On boot the access token is gone (it only ever lived in memory), so we try
   * the refresh cookie once. Success means a real session; failure just means
   * "show the login page" and is not an error worth surfacing.
   */
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await bootstrapSession();
        if (cancelled) return;
        setAccessToken(res.accessToken);
        setUser(res.user);
      } catch {
        if (!cancelled) {
          setAccessToken(null);
          setUser(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setUnauthorizedHandler(() => {
      setAccessToken(null);
      setUser(null);
    });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    setAccessToken(res.accessToken);
    setUser(res.user);
    // Returned so the caller can decide where to land. A platform admin has no
    // cases of their own, and dropping them on the case dashboard shows them an
    // empty screen and no sign that the console they came for exists.
    return res.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } finally {
      setAccessToken(null);
      setUser(null);
    }
  }, []);

  const refreshUser = useCallback(async () => {
    const res = await authApi.me();
    setUser(res.user);
  }, []);

  /**
   * UI gating only — convenience, never a control. The API re-checks every
   * permission on every request.
   */
  const can = useCallback(
    (permission: Permission) => (user ? hasPermission(user.permissions, permission) : false),
    [user],
  );

  const value = useMemo<AuthState>(
    () => ({ user, loading, login, logout, refreshUser, can }),
    [user, loading, login, logout, refreshUser, can],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** Hides an affordance the user cannot use. The server still enforces it. */
export function Can({
  permission,
  children,
  fallback = null,
}: {
  permission: Permission;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { can } = useAuth();
  return <>{can(permission) ? children : fallback}</>;
}
